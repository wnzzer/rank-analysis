use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use tauri::AppHandle;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    client_async,
    tungstenite::{client::IntoClientRequest, handshake::client::Request, protocol::Message},
};
use url::Url;

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

pub struct LcuListener {
    app_handle: AppHandle,
    port: u16,
    token: String,
}

impl LcuListener {
    pub fn new(app_handle: AppHandle, port: u16, token: String) -> Self {
        Self {
            app_handle,
            port,
            token,
        }
    }

    pub async fn start(&self) {
        let auth_header = format!(
            "Basic {}",
            general_purpose::STANDARD.encode(format!("riot:{}", self.token))
        );
        let url_str = format!("wss://127.0.0.1:{}", self.port);
        let url = Url::parse(&url_str).expect("Bad URL");

        // 重连循环
        loop {
            log::info!("正在连接 LCU WebSocket: {}", url);

            // 1. 建立 TCP 连接
            let tcp_stream = match TcpStream::connect(format!("127.0.0.1:{}", self.port)).await {
                Ok(s) => s,
                Err(e) => {
                    log::error!("TCP 连接失败: {}，2秒后重试...", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    continue;
                }
            };

            // 2. 建立 TLS 连接 (忽略证书验证)
            // LCU 使用自签名证书，必须忽略验证
            let cx = native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .expect("创建 TlsConnector 失败");
            let cx = tokio_native_tls::TlsConnector::from(cx);

            let tls_stream = match cx.connect("127.0.0.1", tcp_stream).await {
                Ok(s) => s,
                Err(e) => {
                    log::error!("TLS 握手失败: {}，2秒后重试...", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    continue;
                }
            };

            // 3. 建立 WebSocket 连接
            // 使用 IntoClientRequest 生成完整的 WebSocket 握手请求（包含 Sec-WebSocket-Key）
            let ws_uri = format!("ws://127.0.0.1:{}/", self.port);
            let mut request: Request = match ws_uri.into_client_request() {
                Ok(r) => r,
                Err(e) => {
                    log::error!("创建 WebSocket 请求失败: {}，2秒后重试...", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    continue;
                }
            };
            // 添加 Authorization 头
            request.headers_mut().insert(
                AUTHORIZATION,
                HeaderValue::from_str(&auth_header).expect("Invalid auth header"),
            );

            match client_async(request, tls_stream).await {
                Ok((ws_stream, _)) => {
                    log::info!("LCU WebSocket 已连接");
                    let (mut write, mut read) = ws_stream.split();

                    // 订阅 OnJsonApiEvent (code 5)
                    // 这允许我们需要监听所有 JSON API 的事件
                    // tungstenite 0.28：Message::Text 载荷从 String 改为 Utf8Bytes
                    let subscribe_msg =
                        Message::Text(json!([5, "OnJsonApiEvent"]).to_string().into());
                    if let Err(e) = write.send(subscribe_msg).await {
                        log::error!("订阅 LCU 事件失败: {}，2秒后重试...", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        continue;
                    }

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
                            Ok(Message::Close(_)) => {
                                log::warn!("LCU WebSocket 已关闭，2秒后重试...");
                                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                                break; // 跳出内层循环，进入下一次重连
                            }
                            Err(e) => {
                                log::error!("WebSocket 错误: {}，2秒后重试...", e);
                                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                                break; // 跳出内层循环，进入下一次重连
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    log::error!("连接 LCU WebSocket 失败: {}，2秒后重试...", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                }
            }
        }
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
