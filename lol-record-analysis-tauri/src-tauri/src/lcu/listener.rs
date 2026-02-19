use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};

use tauri::AppHandle;
use tokio::net::TcpStream;
use tokio_tungstenite::{client_async, tungstenite::protocol::Message};
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

        log::info!("正在连接 LCU WebSocket: {}", url);

        // 1. 建立 TCP 连接
        let tcp_stream = match TcpStream::connect(format!("127.0.0.1:{}", self.port)).await {
            Ok(s) => s,
            Err(e) => {
                log::error!("TCP 连接失败: {}", e);
                return;
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
                log::error!("TLS 握手失败: {}", e);
                return;
            }
        };

        // 3. 建立 WebSocket 连接
        let request = tokio_tungstenite::tungstenite::handshake::client::Request::builder()
            .uri(url.as_str())
            .header("Authorization", auth_header)
            .body(())
            .unwrap();

        match client_async(request, tls_stream).await {
            Ok((ws_stream, _)) => {
                log::info!("LCU WebSocket 已连接");
                let (mut write, mut read) = ws_stream.split();

                // 订阅 OnJsonApiEvent (code 5)
                // 这允许我们需要监听所有 JSON API 的事件
                let subscribe_msg = Message::Text(json!([5, "OnJsonApiEvent"]).to_string());
                if let Err(e) = write.send(subscribe_msg).await {
                    log::error!("订阅 LCU 事件失败: {}", e);
                    return;
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
                            log::warn!("LCU WebSocket 已关闭");
                            break;
                        }
                        Err(e) => {
                            log::error!("WebSocket 错误: {}", e);
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Err(e) => {
                log::error!("连接 LCU WebSocket 失败: {}", e);
            }
        }
    }

    async fn handle_event(&self, event: &Value) {
        if let Some(uri) = event.get("uri").and_then(|v| v.as_str()) {
            // 分发事件
            // 根据需要的 URI 进行过滤，避免无效刷新
            if uri == "/lol-gameflow/v1/gameflow-phase"
                || uri == "/lol-champ-select/v1/session"
                || uri == "/lol-lobby/v2/lobby"
            {
                log::info!("收到 LCU 事件: {}", uri);

                // 触发后端的会话数据刷新逻辑
                match crate::command::session::get_session_data(self.app_handle.clone()).await {
                    Ok(_) => {
                        log::info!("通过 WebSocket 事件更新了 Session 数据");
                    }
                    Err(e) => {
                        log::error!("通过 WebSocket 更新 Session 数据失败: {}", e);
                    }
                }
            }
        }
    }
}
