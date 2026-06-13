//! # AI 分析命令模块
//!
//! 提供流式 AI 分析功能，直连 DashScope (通义千问) OpenAI 兼容端点。
//!
//! ## 主要功能
//!
//! - **流式 AI 请求**: 通过 Tauri Channel 实现 SSE 流式输出到前端
//! - **DashScope (通义千问)**: 调 OpenAI 兼容端点，密钥在 Rust 层解析（见 resolve_api_key）
//!
//! ## 使用示例
//!
//! ```ts
//! // 前端调用（参数为 camelCase，与 AiStreamRequest 的 serde rename 对应）
//! const channel = new Channel<AiStreamEvent>()
//! channel.onmessage = (e) => { /* e.event: 'chunk' | 'done' | 'error' */ }
//! await invoke('stream_ai_analysis', {
//!   request: { prompt: '分析这段战绩...', systemPrompt: '你是LOL分析师...' },
//!   onEvent: channel
//! })
//! ```

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tauri::ipc::Channel;

/// DashScope OpenAI 兼容 chat 端点。
const DASHSCOPE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

/// 前端未指定 model 时的兜底（发布前 benchmark 后可调，见计划 Task 7）。
const DEFAULT_MODEL: &str = "qwen-plus";

/// 按优先级解析 DashScope 密钥：用户覆盖 > 运行时环境变量 > 编译期注入。
/// 空白串视同未配置。纯函数，便于单测。
fn resolve_api_key(
    override_key: Option<&str>,
    runtime_env: Option<&str>,
    baked: Option<&str>,
) -> Result<String, String> {
    for k in [override_key, runtime_env, baked].into_iter().flatten() {
        let trimmed = k.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Err("未配置 DashScope 密钥（设置 DASHSCOPE_API_KEY 环境变量，或在设置中填入）".to_string())
}

/// 解析最终密钥：用户覆盖 → 运行时环境变量（测试/开发）→ `option_env!` 编译期注入（线上）。
/// 线上由 CI 在构建时设 `DASHSCOPE_API_KEY`，明文密钥不进源码 / git。
fn api_key(override_key: Option<&str>) -> Result<String, String> {
    let runtime = std::env::var("DASHSCOPE_API_KEY").ok();
    resolve_api_key(
        override_key,
        runtime.as_deref(),
        option_env!("DASHSCOPE_API_KEY"),
    )
}

/// 从一行 SSE 文本提取增量 token。接受带或不带 `data: ` 前缀的行；
/// `[DONE]`、坏 JSON、缺 `choices[0].delta.content` 均返回 `None`。
fn extract_delta_content(line: &str) -> Option<String> {
    let data = line.trim();
    let data = data.strip_prefix("data: ").unwrap_or(data).trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    let content = json
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()?;
    if content.is_empty() {
        None
    } else {
        Some(content.to_string())
    }
}

/// AI 请求参数
///
/// `rename_all = "camelCase"`：前端 invoke 传 `systemPrompt` / `apiKey`（camelCase），
/// 必须与 Rust snake_case 字段对齐，否则 serde 反序列化失败。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamRequest {
    pub prompt: String,
    pub system_prompt: Option<String>,
    /// 模型名（如 `qwen-plus`）；缺省用 `DEFAULT_MODEL`
    pub model: Option<String>,
    /// 用户在设置中填的覆盖密钥；空 / 缺省时用 env / 编译期注入
    pub api_key: Option<String>,
}

/// AI 流式响应事件
#[derive(Debug, Clone, Serialize)]
pub struct AiStreamEvent {
    /// 事件类型: "chunk" | "done" | "error"
    pub event: String,
    /// 数据内容（chunk 时为文本，error 时为错误信息）
    pub data: Option<String>,
}

/// 流式 AI 分析命令
///
/// # 参数
///
/// - `request`: AI 请求参数（包含 prompt 和可选的 system_prompt）
/// - `on_event`: Tauri Channel，用于向前端发送流式事件
///
/// # 返回值
///
/// - `Ok(())`: 流式传输完成
/// - `Err(String)`: 请求失败，返回错误信息
#[tauri::command]
pub async fn stream_ai_analysis(
    request: AiStreamRequest,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    // 解析密钥（用户覆盖 → env → 编译期注入）。失败时发 error 事件并结束（不 reject 命令）。
    let key = match api_key(request.api_key.as_deref()) {
        Ok(k) => k,
        Err(e) => {
            let _ = on_event.send(AiStreamEvent {
                event: "error".to_string(),
                data: Some(e),
            });
            return Ok(());
        }
    };
    let model = request
        .model
        .as_deref()
        .unwrap_or(DEFAULT_MODEL)
        .to_string();

    // 构建请求头
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", key))
            .map_err(|e| format!("Invalid API key: {}", e))?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    // 构建请求体
    let system_prompt = request
        .system_prompt
        .unwrap_or_else(|| "你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁、专业、直接的中文回复。".to_string());

    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": request.prompt }
        ],
        "stream": true
    });

    // 创建 HTTP 客户端
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // 发送请求
    let response = client
        .post(DASHSCOPE_URL)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    // 检查响应状态
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        let _ = on_event.send(AiStreamEvent {
            event: "error".to_string(),
            data: Some(format!("API error ({}): {}", status, error_text)),
        });
        return Ok(());
    }

    // 获取响应流
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    use futures::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                // 处理缓冲区的完整行
                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].trim().to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if let Some(content) = extract_delta_content(&line) {
                        let _ = on_event.send(AiStreamEvent {
                            event: "chunk".to_string(),
                            data: Some(content),
                        });
                    }
                }
            }
            Err(e) => {
                let _ = on_event.send(AiStreamEvent {
                    event: "error".to_string(),
                    data: Some(format!("Stream error: {}", e)),
                });
                return Ok(());
            }
        }
    }

    // 发送完成事件
    let _ = on_event.send(AiStreamEvent {
        event: "done".to_string(),
        data: None,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_prefers_override_then_env_then_baked() {
        assert_eq!(
            resolve_api_key(Some("ov"), Some("env"), Some("baked")).unwrap(),
            "ov"
        );
        assert_eq!(
            resolve_api_key(None, Some("env"), Some("baked")).unwrap(),
            "env"
        );
        assert_eq!(resolve_api_key(None, None, Some("baked")).unwrap(), "baked");
    }

    #[test]
    fn resolve_treats_blank_as_unset() {
        // 覆盖为空白时应跳到下一优先级，而不是用空 key
        assert_eq!(
            resolve_api_key(Some("  "), Some("env"), None).unwrap(),
            "env"
        );
        assert_eq!(
            resolve_api_key(Some(""), None, Some("baked")).unwrap(),
            "baked"
        );
    }

    #[test]
    fn resolve_errors_when_all_unset() {
        assert!(resolve_api_key(None, None, None).is_err());
        assert!(resolve_api_key(Some(" "), Some(""), None).is_err());
    }

    #[test]
    fn extract_pulls_delta_content() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#;
        assert_eq!(extract_delta_content(line), Some("你好".to_string()));
    }

    #[test]
    fn extract_handles_done_and_garbage() {
        assert_eq!(extract_delta_content("data: [DONE]"), None);
        assert_eq!(extract_delta_content("data: {not json"), None);
        assert_eq!(extract_delta_content(""), None);
        // 有结构但无 content 字段（如仅 role 的首包）
        assert_eq!(
            extract_delta_content(r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#),
            None
        );
    }
}
