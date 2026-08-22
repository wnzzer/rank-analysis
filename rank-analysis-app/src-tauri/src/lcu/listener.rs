//! LCU WebSocket 事件监听。
//!
//! 设计要点（对应排查报告 H2/M9）：
//! - **认证每轮现取**：构造时不再固化 port/token，每次（重）连前经
//!   [`crate::lcu::util::token::get_auth`] 现取——客户端重启后端口与令牌都会变化，
//!   固化旧值会让监听器永远连着已失效的端口。
//! - **代际去重**：模块级代际号在每次 [`LcuListener::start`] 时自增；旧实例在
//!   重连检查点发现自己已被取代即自行退出，杜绝「连接抖动 → 多个监听器并存、
//!   同一事件触发两遍会话刷新」以及僵尸任务无限累积。
//! - **读空闲超时**：`read` 挂一层空闲超时，TCP 半开（休眠唤醒/网络切换）时能
//!   自愈重建，而不是永久挂死且无任何日志。
//! - **会话刷新防抖**：champ-select/gameflow 事件在选人期每秒可达数次，500ms
//!   防抖窗口内合并为一次 `get_session_data`，避免领号→白跑→作废的任务 churn。

use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    client_async,
    tungstenite::{client::IntoClientRequest, handshake::client::Request, protocol::Message},
};

/// 当前活跃监听器的代际号：每次 spawn 新监听器自增，旧监听器发现落后即退出。
static LISTENER_GENERATION: AtomicU64 = AtomicU64::new(0);

/// TCP/TLS/WS 握手整体超时。LCU 在本机，正常握手亚秒级完成；
/// 超时说明客户端正在退出或端口已失效，不值得久等。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// 读空闲超时：超过该时长未收到任何帧（LCU 正常时会周期推送事件）视为半开连接，
/// 主动断开进入重连循环。
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// 同一来源事件的会话刷新最小间隔（防抖窗口）。
const SESSION_REFRESH_DEBOUNCE: Duration = Duration::from_millis(500);

pub struct LcuListener {
    app_handle: AppHandle,
}

impl LcuListener {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    /// 启动监听（常驻直到进程退出或被更新代际的实例取代）。
    pub async fn start(&self) {
        let my_generation = LISTENER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

        // 重连循环
        loop {
            // 代际检查点：已有更新的监听器接管，本实例立即退出，
            // 不再对已失效的端口制造每 2 秒一次的失败连接。
            if LISTENER_GENERATION.load(Ordering::SeqCst) != my_generation {
                log::info!("LCU WebSocket 监听器已被新实例取代，当前实例退出");
                return;
            }

            // 每轮（重）连前现取认证：客户端重启后端口/token 会变，
            // 固化旧值是「WS 永久失聪而 HTTP 正常」的直接成因。
            let (token, port_str) = match crate::lcu::util::token::get_auth() {
                Ok(pair) => pair,
                Err(e) => {
                    log::error!("获取 LCU 认证信息失败: {}，2秒后重试...", e);
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            };
            let port: u16 = match port_str.parse() {
                Ok(p) => p,
                Err(_) => {
                    log::error!("解析端口失败: {}，2秒后重试...", port_str);
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            };

            let auth_header = format!(
                "Basic {}",
                general_purpose::STANDARD.encode(format!("riot:{}", token))
            );

            // 会话刷新防抖时间戳（跨重连保留在本方法栈上）
            let mut last_refresh = Instant::now() - SESSION_REFRESH_DEBOUNCE;

            // 握手整体包一层 CONNECT_TIMEOUT：TLS/WS 阶段卡死时也能收敛进重连循环
            match tokio::time::timeout(CONNECT_TIMEOUT, self.connect_once(port, &auth_header)).await
            {
                Ok(Ok(ws_stream)) => {
                    log::info!("LCU WebSocket 已连接");
                    let (mut write, mut read) = ws_stream.split();

                    // 订阅 OnJsonApiEvent (code 5)
                    // 这允许我们需要监听所有 JSON API 的事件
                    // tungstenite 0.28：Message::Text 载荷从 String 改为 Utf8Bytes
                    let subscribe_msg =
                        Message::Text(json!([5, "OnJsonApiEvent"]).to_string().into());
                    if let Err(e) = write.send(subscribe_msg).await {
                        log::error!("订阅 LCU 事件失败: {}，2秒后重试...", e);
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        continue;
                    }

                    loop {
                        // 读空闲超时：半开连接下 read.next() 会永久挂起，
                        // 超时主动放弃本次连接，回外层重连并重新取认证。
                        let next_msg = tokio::time::timeout(READ_IDLE_TIMEOUT, read.next()).await;
                        match next_msg {
                            Err(_elapsed) => {
                                log::warn!(
                                    "LCU WebSocket {} 秒无数据，判定为半开连接，重建...",
                                    READ_IDLE_TIMEOUT.as_secs()
                                );
                                break;
                            }
                            Ok(None) => {
                                log::warn!("LCU WebSocket 流已结束，2秒后重连...");
                                tokio::time::sleep(Duration::from_secs(2)).await;
                                break;
                            }
                            Ok(Some(msg)) => match msg {
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
                                                self.handle_event(event_data, &mut last_refresh)
                                                    .await;
                                            }
                                        }
                                    }
                                }
                                Ok(Message::Close(_)) => {
                                    log::warn!("LCU WebSocket 已关闭，2秒后重连...");
                                    tokio::time::sleep(Duration::from_secs(2)).await;
                                    break; // 跳出内层循环，进入下一次重连
                                }
                                Err(e) => {
                                    log::error!("WebSocket 错误: {}，2秒后重连...", e);
                                    tokio::time::sleep(Duration::from_secs(2)).await;
                                    break; // 跳出内层循环，进入下一次重连
                                }
                                _ => {}
                            },
                        }
                    }
                }
                Ok(Err(e)) => {
                    log::error!("连接 LCU WebSocket 失败: {}，2秒后重试...", e);
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
                Err(_) => {
                    log::error!(
                        "连接 LCU WebSocket 超时（>{}s），2秒后重试...",
                        CONNECT_TIMEOUT.as_secs()
                    );
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    }

    /// 建立一条 WebSocket 连接（TCP + TLS + 握手），任一步超时/失败返回 Err。
    async fn connect_once(
        &self,
        port: u16,
        auth_header: &str,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<tokio_native_tls::TlsStream<tokio::net::TcpStream>>,
        String,
    > {
        // 1. 建立 TCP 连接
        let tcp_stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .await
            .map_err(|e| format!("TCP 连接失败: {}", e))?;

        // 2. 建立 TLS 连接 (忽略证书验证)
        // LCU 使用自签名证书，必须忽略验证
        let cx = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .expect("创建 TlsConnector 失败");
        let cx = tokio_native_tls::TlsConnector::from(cx);

        let tls_stream = cx
            .connect("127.0.0.1", tcp_stream)
            .await
            .map_err(|e| format!("TLS 握手失败: {}", e))?;

        // 3. 建立 WebSocket 连接
        // 使用 IntoClientRequest 生成完整的 WebSocket 握手请求（包含 Sec-WebSocket-Key）
        let ws_uri = format!("ws://127.0.0.1:{}/", port);
        let mut request: Request = ws_uri
            .into_client_request()
            .map_err(|e| format!("创建 WebSocket 请求失败: {}", e))?;
        // 添加 Authorization 头
        request.headers_mut().insert(
            AUTHORIZATION,
            HeaderValue::from_str(auth_header).expect("Invalid auth header"),
        );

        client_async(request, tls_stream)
            .await
            .map(|(ws, _)| ws)
            .map_err(|e| format!("WebSocket 握手失败: {}", e))
    }

    async fn handle_event(&self, event: &Value, last_refresh: &mut Instant) {
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
                // 防抖：选人期同一 URI 每秒可触发数次，500ms 窗口内的后续事件
                // 直接丢弃（下一次事件仍会兜底刷新），避免大量白跑的会话任务。
                if last_refresh.elapsed() < SESSION_REFRESH_DEBOUNCE {
                    return;
                }
                *last_refresh = Instant::now();

                log::info!("收到 LCU 事件: {}", uri);

                // 触发后端的会话数据刷新逻辑
                if let Err(e) =
                    crate::command::session::get_session_data(self.app_handle.clone()).await
                {
                    log::error!("通过 WebSocket 更新 Session 数据失败: {}", e);
                } else {
                    log::info!("通过 WebSocket 事件 [{}] 更新了 Session 数据", uri);
                }
            }
        }
    }
}
