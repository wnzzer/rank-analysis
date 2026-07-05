use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};

use tauri::AppHandle;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    client_async,
    tungstenite::{client::IntoClientRequest, handshake::client::Request, protocol::Message},
};
use url::Url;

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
