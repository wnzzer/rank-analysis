use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use crate::lcu::util::http::{get_auth_pair, refresh_auth};
use tauri::AppHandle;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    client_async,
    tungstenite::{client::IntoClientRequest, handshake::client::Request, protocol::Message},
};

/// Session 刷新的合并窗口。
///
/// 窗口内的事件合并成一次刷新：刷新最多延迟这么久，选人期每秒最多重建 4 轮。
const SESSION_REFRESH_WINDOW: Duration = Duration::from_millis(250);

static SESSION_REFRESH: RefreshCoalescer = RefreshCoalescer::new();

/// 把一串触发请求合并成「窗口末尾执行一次」。
///
/// 第一个请求负责调度一次延迟执行，窗口内后续请求只计数；执行时 [`take`](Self::take)
/// 重置状态，此后到来的请求会再调度新的一次，因此执行期间发生的变化不会丢。
/// 与「每来一个事件就重置计时」的防抖不同，持续不断的事件流不会把刷新无限推迟。
struct RefreshCoalescer {
    pending: AtomicBool,
    merged: AtomicU32,
}

impl RefreshCoalescer {
    const fn new() -> Self {
        Self {
            pending: AtomicBool::new(false),
            merged: AtomicU32::new(0),
        }
    }

    /// 登记一次刷新请求；返回 `true` 表示调用方需要调度这次刷新。
    fn request(&self) -> bool {
        self.merged.fetch_add(1, Ordering::SeqCst);
        !self.pending.swap(true, Ordering::SeqCst)
    }

    /// 即将执行刷新：重置状态并返回本窗口合并的请求数。
    fn take(&self) -> u32 {
        self.pending.store(false, Ordering::SeqCst);
        self.merged.swap(0, Ordering::SeqCst)
    }
}

/// 断线 / 连接失败后的重连间隔。
const RECONNECT_DELAY: Duration = Duration::from_secs(2);

/// LCU WebSocket 监听器：订阅 `OnJsonApiEvent` 并把关心的事件分发出去。
///
/// 不持有端口 / 令牌：每次（重）连接都从 HTTP 层的共享认证缓存现取
/// （[`get_auth_pair`]），客户端重启换了端口 / 令牌也能连上新实例，
/// 而不是对着旧端口永远空转。
pub struct LcuListener {
    app_handle: AppHandle,
}

impl LcuListener {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    /// 连接并持续分发事件，断线自动重连。
    ///
    /// # 行为
    /// - 永不自行返回（TLS 初始化失败除外）：生命周期由调用方持有的 `JoinHandle`
    ///   控制，见 [`crate::game_state_monitor`]——客户端断开或重新连接时 abort
    /// - 连接阶段失败视为认证可能过期，刷新认证后再重连
    pub async fn start(&self) {
        // LCU 使用自签名证书，必须忽略验证
        let cx = match native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
        {
            Ok(cx) => tokio_native_tls::TlsConnector::from(cx),
            Err(e) => {
                log::error!("创建 TlsConnector 失败，WebSocket 监听未启动: {}", e);
                return;
            }
        };

        loop {
            match self.connect_and_dispatch(&cx).await {
                Ok(()) => log::warn!("LCU WebSocket 已关闭，2秒后重连..."),
                Err(e) => {
                    log::error!("{}，2秒后重试...", e);
                    if let Err(e) = refresh_auth() {
                        log::info!("刷新LCU认证失败（客户端可能已退出）: {}", e);
                    }
                }
            }
            tokio::time::sleep(RECONNECT_DELAY).await;
        }
    }

    /// 建立一次 WebSocket 连接并分发事件，直到连接结束。
    ///
    /// 服务端正常关闭返回 `Ok`，连接阶段或读取出错返回 `Err`（附原因）。
    async fn connect_and_dispatch(
        &self,
        cx: &tokio_native_tls::TlsConnector,
    ) -> Result<(), String> {
        let (token, port) = get_auth_pair().map_err(|e| format!("获取 LCU 认证失败: {}", e))?;
        log::info!("正在连接 LCU WebSocket: wss://127.0.0.1:{}", port);

        // 1. 建立 TCP 连接
        let tcp_stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .await
            .map_err(|e| format!("TCP 连接失败: {}", e))?;

        // 2. 建立 TLS 连接
        let tls_stream = cx
            .connect("127.0.0.1", tcp_stream)
            .await
            .map_err(|e| format!("TLS 握手失败: {}", e))?;

        // 3. 建立 WebSocket 连接
        // 使用 IntoClientRequest 生成完整的 WebSocket 握手请求（包含 Sec-WebSocket-Key）
        let mut request: Request = format!("ws://127.0.0.1:{}/", port)
            .into_client_request()
            .map_err(|e| format!("创建 WebSocket 请求失败: {}", e))?;
        let auth_header = format!(
            "Basic {}",
            general_purpose::STANDARD.encode(format!("riot:{}", token))
        );
        let auth_value =
            HeaderValue::from_str(&auth_header).map_err(|e| format!("认证头非法: {}", e))?;
        request.headers_mut().insert(AUTHORIZATION, auth_value);

        let (ws_stream, _) = client_async(request, tls_stream)
            .await
            .map_err(|e| format!("连接 LCU WebSocket 失败: {}", e))?;
        log::info!("LCU WebSocket 已连接");
        let (mut write, mut read) = ws_stream.split();

        // 订阅 OnJsonApiEvent (code 5)
        // 这允许我们需要监听所有 JSON API 的事件
        // tungstenite 0.28：Message::Text 载荷从 String 改为 Utf8Bytes
        let subscribe_msg = Message::Text(json!([5, "OnJsonApiEvent"]).to_string().into());
        write
            .send(subscribe_msg)
            .await
            .map_err(|e| format!("订阅 LCU 事件失败: {}", e))?;

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if text.is_empty() {
                        continue;
                    }

                    if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                        if let Some(array) = parsed.as_array() {
                            // 确保是事件类型 (opcode 8)
                            // 格式通常为: [8, "OnJsonApiEvent", { ...data... }]
                            if array.len() >= 3
                                && array[0] == json!(8)
                                && array[1] == "OnJsonApiEvent"
                            {
                                let event_data = &array[2];
                                self.handle_event(event_data).await;
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => return Ok(()),
                Err(e) => return Err(format!("WebSocket 错误: {}", e)),
                _ => {}
            }
        }
        Ok(())
    }

    async fn handle_event(&self, event: &Value) {
        if let Some(uri) = event.get("uri").and_then(|v| v.as_str()) {
            // 检查是否也是 data 字段，有些事件结构不一样
            let data = event.get("data");

            // 如果是 phase 变化事件，更新缓存
            if uri == "/lol-gameflow/v1/gameflow-phase" {
                if let Some(phase) = data.and_then(|d| d.as_str()) {
                    crate::lcu::api::phase::update_phase_cache(phase.to_string());
                }
            }

            // 分发事件
            // 根据需要的 URI 进行过滤，避免无效刷新
            if uri == "/lol-gameflow/v1/gameflow-phase"
                || uri == "/lol-champ-select/v1/session"
                || uri == "/lol-lobby/v2/lobby"
                || uri == "/lol-gameflow/v1/session"
            {
                log::info!("收到 LCU 事件: {}", uri);

                // 选人期 champ-select 事件一秒数次，逐个触发会 10 人全量重建好几轮；
                // 合并到窗口末尾只刷一次（窗口内最后的状态以重建时现拉为准，不会丢）。
                if !SESSION_REFRESH.request() {
                    return;
                }
                let app_handle = self.app_handle.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(SESSION_REFRESH_WINDOW).await;
                    let merged = SESSION_REFRESH.take();
                    log::info!("刷新 Session 数据（合并了 {} 个 LCU 事件）", merged);
                    if let Err(e) = crate::command::session::get_session_data(app_handle).await {
                        log::error!("通过 WebSocket 更新 Session 数据失败: {}", e);
                    }
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_schedule_only_first_request_in_window() {
        let c = RefreshCoalescer::new();

        assert!(c.request());
        assert!(!c.request());
        assert!(!c.request());

        assert_eq!(c.take(), 3);
    }

    #[test]
    fn should_schedule_again_after_take() {
        let c = RefreshCoalescer::new();
        c.request();
        c.take();

        // 刷新执行期间 / 之后到来的事件要能触发新的一轮
        assert!(c.request());
        assert_eq!(c.take(), 1);
    }
}
