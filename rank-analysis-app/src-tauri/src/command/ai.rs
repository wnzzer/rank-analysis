//! # AI 分析命令模块
//!
//! 提供流式 AI 分析功能，直连兼容 OpenAI 协议的端点（D-P4 平台化：多 provider）。
//!
//! ## 主要功能
//!
//! - **流式 AI 请求**: 通过 Tauri Channel 实现 SSE 流式输出到前端
//! - **Provider 抽象**(D-P4): 请求参数带 `provider` 与 `baseUrl`，路由到三类端点
//!   - `dashscope`: 通义千问 OpenAI 兼容端点（默认，密钥三层解析见 resolve_api_key）
//!   - `openai`: OpenAI 兼容自建/DeepSeek 等，密钥走 `OPENAI_API_KEY` 或设置覆盖
//!   - `ollama`: 本地模型，免密钥，`baseUrl` 默认 `http://127.0.0.1:11434`
//!
//! ## 使用示例
//!
//! ```ts
//! // 前端调用（参数为 camelCase，与 AiStreamRequest 的 serde rename 对应）
//! const channel = new Channel<AiStreamEvent>()
//! channel.onmessage = (e) => { /* e.event: 'chunk' | 'done' | 'error' */ }
//! await invoke('stream_ai_analysis', {
//!   request: { prompt: '分析这段战绩...', systemPrompt: '你是LOL分析师...', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
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

/// OpenAI 兼容 provider 未指定 baseUrl 时的兜底（DeepSeek 官方端点）。
const DEFAULT_OPENAI_URL: &str = "https://api.deepseek.com/chat/completions";

/// Ollama 本地端点默认地址（v1 OpenAI 兼容）。
const DEFAULT_OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";

/// 前端未指定 model 时的兜底。
/// qwen-flash：真实基准（tests/bench-ai-models.mjs）Stage1 ~12s/2-of-2 有效、Stage2 ~6s，
/// 速度与有效率均优于 qwen-plus（~40s 且约半数非法 JSON），故定为默认。
const DEFAULT_MODEL: &str = "qwen-flash";

/// AI 服务商（D-P4 平台化）。
///
/// # 说明
///
/// 未知字符串一律按 `DashScope` 处理（向前兼容：老客户端不带 provider 字段）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiProviderKind {
    DashScope,
    OpenAICompatible,
    Ollama,
}

impl AiProviderKind {
    /// 解析前端传入的 provider 字符串；缺省/未知值回退 `DashScope`。纯函数，便于单测。
    pub fn parse(s: Option<&str>) -> Self {
        match s.map(str::trim).unwrap_or_default() {
            "openai" | "deepseek" => Self::OpenAICompatible,
            "ollama" => Self::Ollama,
            _ => Self::DashScope,
        }
    }

    /// 前端可辨识的标识（settings 的 select 用值）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DashScope => "dashscope",
            Self::OpenAICompatible => "openai",
            Self::Ollama => "ollama",
        }
    }
}

/// 解析 provider 对应的 chat 端点。纯函数，便于单测。
///
/// - `dashscope`: 固定官方端点，忽略 base_url
/// - `openai`: base_url 非空时原样使用（兼容 /v1 前缀差异），否则 `DEFAULT_OPENAI_URL`
/// - `ollama`: `{base_url}/v1/chat/completions`，base_url 缺省用 `DEFAULT_OLLAMA_BASE_URL`
fn provider_endpoint(kind: AiProviderKind, base_url: Option<&str>) -> String {
    match kind {
        AiProviderKind::DashScope => DASHSCOPE_URL.to_string(),
        AiProviderKind::OpenAICompatible => {
            let base = base_url.map(str::trim).filter(|s| !s.is_empty());
            base.unwrap_or(DEFAULT_OPENAI_URL).to_string()
        }
        AiProviderKind::Ollama => {
            let base = base_url
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(DEFAULT_OLLAMA_BASE_URL)
                .trim_end_matches('/');
            format!("{}/v1/chat/completions", base)
        }
    }
}

/// 按 provider 解析 API 密钥。纯函数，便于单测。
///
/// - `dashscope`: 用户覆盖 > 运行时 `DASHSCOPE_API_KEY` > 编译期注入（现有三层，baked 仅此服务商有）
/// - `openai`: 用户覆盖 > 运行时 `OPENAI_API_KEY`（无 baked 兜底，错误信息带环境变量名提示）
/// - `ollama`: 本地免密钥，恒 `Ok(None)`
fn provider_api_key(
    kind: AiProviderKind,
    override_key: Option<&str>,
    runtime_env: Option<&str>,
    baked: Option<&str>,
) -> Result<Option<String>, String> {
    match kind {
        AiProviderKind::Ollama => Ok(None),
        AiProviderKind::OpenAICompatible => resolve_api_key(override_key, runtime_env, baked)
            .map(Some)
            .map_err(|_| {
                "未配置 API 密钥（设置 OPENAI_API_KEY 环境变量，或在设置中填入）".to_string()
            }),
        AiProviderKind::DashScope => resolve_api_key(override_key, runtime_env, baked)
            .map(Some)
            .map_err(|_| {
                "未配置 API 密钥（设置 DASHSCOPE_API_KEY 环境变量，或在设置中填入）".to_string()
            }),
    }
}

/// provider 未传 model 时的默认模型（按服务商）。
fn provider_default_model(kind: AiProviderKind) -> &'static str {
    match kind {
        AiProviderKind::DashScope => DEFAULT_MODEL,
        // OpenAI 兼容兜底（DeepSeek 语音外常规）；根绝“模型不存在”需在设置里按实际服务商填
        AiProviderKind::OpenAICompatible => "deepseek-chat",
        AiProviderKind::Ollama => "llama3.1",
    }
}

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
    Err("未配置 API 密钥（设置环境变量或在设置中填入）".to_string())
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

/// 总请求超时（含流式全程）。qwen-flash 实测总耗时 ~12s，60s 足够覆盖慢响应，
/// 又不至于像原来的 120s 那样长时间"假死"。
const REQUEST_TIMEOUT_SECS: u64 = 60;

/// 首字看门狗：发起后多久没等到首个响应字节就判这次尝试失败（专治长时间转圈）。
const FIRST_TOKEN_TIMEOUT_SECS: u64 = 20;

/// 首块到达前的最大尝试次数（含首次）。仅在"流尚未开始"时重试，避免重复输出。
const MAX_ATTEMPTS: u32 = 2;

/// 构建 DashScope chat 请求体。纯函数，便于单测。
///
/// `response_format` 为 `Some` 时附加 OpenAI 兼容的 `response_format: {"type": ...}`
/// 字段（如 `json_object` 强制 JSON 输出）；`None` 时不带该字段，保持普通文本输出。
///
/// 恒带 `stream_options.include_usage: true`：DashScope 兼容端点在流末 chunk 返回
/// `usage` 字段，供 D-P1 前端统计每次分析的 token 用量（成本）。
fn build_request_body(
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    response_format: Option<&str>,
) -> serde_json::Value {
    let mut body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "stream": true,
        "stream_options": { "include_usage": true }
    });
    if let Some(fmt) = response_format {
        body["response_format"] = json!({ "type": fmt });
    }
    body
}

/// 从一行 SSE 文本提取 usage（流末 chunk 的 `usage` 字段）。
/// 返回规范化后的 `{ promptTokens, completionTokens, totalTokens }`；无 usage /
/// `[DONE]` / 坏 JSON 均返回 `None`。
fn extract_usage(line: &str) -> Option<serde_json::Value> {
    let data = line.trim();
    let data = data.strip_prefix("data: ").unwrap_or(data).trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    let usage = json.get("usage")?;
    if usage.get("total_tokens").is_none() && usage.get("totalTokens").is_none() {
        return None;
    }
    // DashScope 兼容模式用 snake_case，个别端到端用 camelCase，两者都认
    let get = |snake: &str, camel: &str| {
        usage
            .get(snake)
            .or_else(|| usage.get(camel))
            .and_then(|v| v.as_i64())
            .unwrap_or_default()
    };
    Some(json!({
        "promptTokens": get("prompt_tokens", "promptTokens"),
        "completionTokens": get("completion_tokens", "completionTokens"),
        "totalTokens": get("total_tokens", "totalTokens")
    }))
}

/// HTTP 状态码是否值得重试：仅 429（限流）与 5xx（服务端错误）。纯函数，便于单测。
fn is_retryable_status(status: u16) -> bool {
    status == 429 || (500..=599).contains(&status)
}

/// 首块前重试的退避时长（`attempt` 为 1 基的尝试序号）。纯函数，便于单测。
fn backoff_delay(attempt: u32) -> Duration {
    Duration::from_millis(match attempt {
        1 => 800,
        _ => 2000,
    })
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
    /// OpenAI 兼容 `response_format.type`（如 `json_object`，强制模型输出合法 JSON）。
    /// 缺省不传该字段（普通文本/markdown 输出）。
    pub response_format: Option<String>,
    /// 服务商标识（D-P4）：`dashscope` | `openai` | `ollama`；缺省 / 未知值按 `dashscope` 处理
    pub provider: Option<String>,
    /// 服务商自定义端点（D-P4）：仅 `openai` / `ollama` 使用，缺省用各自官方默认值
    pub base_url: Option<String>,
}

/// AI 流式响应事件
#[derive(Debug, Clone, Serialize)]
pub struct AiStreamEvent {
    /// 事件类型: "chunk" | "done" | "error" | "usage"
    pub event: String,
    /// 数据内容（chunk 时为文本，error 时为错误信息，usage 时为 token 用量 JSON）
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
    // 解析服务商与端点（D-P4）：未知 / 缺省回退 DashScope，兼容老客户端
    let kind = AiProviderKind::parse(request.provider.as_deref());
    let endpoint = provider_endpoint(kind, request.base_url.as_deref());

    // 解析密钥（用户覆盖 → env → 编译期注入；仅 dashscope 有内置 key 兜底，
    // openai 的 env 名是 OPENAI_API_KEY，ollama 本地免密钥）。失败时发 error 事件并结束。
    let runtime_env = match kind {
        AiProviderKind::DashScope => std::env::var("DASHSCOPE_API_KEY").ok(),
        AiProviderKind::OpenAICompatible => std::env::var("OPENAI_API_KEY").ok(),
        AiProviderKind::Ollama => None,
    };
    let baked = (kind == AiProviderKind::DashScope)
        .then_some(option_env!("DASHSCOPE_API_KEY"))
        .flatten();
    let key = match provider_api_key(
        kind,
        request.api_key.as_deref(),
        runtime_env.as_deref(),
        baked,
    ) {
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
        .unwrap_or_else(|| provider_default_model(kind))
        .to_string();

    // 构建请求头（ollama 本地免认证，不带 Authorization）
    let mut headers = HeaderMap::new();
    if let Some(key) = &key {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", key))
                .map_err(|e| format!("Invalid API key: {}", e))?,
        );
    }
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    // 构建请求体。
    // 注意：canonical 系统提示词在前端 `stream.ts` 的 `DEFAULT_SYSTEM_PROMPT`，
    // 所有调用路径都会带上非空 systemPrompt，下面仅是 systemPrompt 缺省时的兜底，
    // 不要在此处维护"权威"提示词（避免与前端分叉）。
    let system_prompt = request
        .system_prompt
        .unwrap_or_else(|| "你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁、专业、直接的中文回复。".to_string());

    let body = build_request_body(
        &model,
        &system_prompt,
        &request.prompt,
        request.response_format.as_deref(),
    );

    // 创建 HTTP 客户端（总超时收紧到 REQUEST_TIMEOUT_SECS）
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    use futures::StreamExt;

    // 首块到达前可重试：建连失败 / 可重试状态码 / 首字看门狗超时都算"流未开始"，
    // 退避后再试。一旦拿到首个响应字节（已视为开始流），跳出循环，后续不再重试，
    // 避免向前端重复 emit chunk。
    let (mut stream, first_bytes) = {
        let mut attempt = 0u32;
        loop {
            attempt += 1;

            let response = match client
                .post(&endpoint)
                .headers(headers.clone())
                .json(&body)
                .send()
                .await
            {
                Ok(resp) => resp,
                Err(e) => {
                    // 建连 / 超时类错误：未开始流，可重试
                    if attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(backoff_delay(attempt)).await;
                        continue;
                    }
                    let _ = on_event.send(AiStreamEvent {
                        event: "error".to_string(),
                        data: Some(format!("HTTP request failed: {}", e)),
                    });
                    return Ok(());
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                if is_retryable_status(status.as_u16()) && attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(backoff_delay(attempt)).await;
                    continue;
                }
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

            // 首字看门狗：等首个响应字节，超时 / 流即报错 / 空流都判这次尝试失败
            let mut s = response.bytes_stream();
            match tokio::time::timeout(Duration::from_secs(FIRST_TOKEN_TIMEOUT_SECS), s.next())
                .await
            {
                Ok(Some(Ok(bytes))) => break (s, bytes),
                _ => {
                    if attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(backoff_delay(attempt)).await;
                        continue;
                    }
                    let _ = on_event.send(AiStreamEvent {
                        event: "error".to_string(),
                        data: Some(format!(
                            "首响应超时或为空（{}s 内无数据）",
                            FIRST_TOKEN_TIMEOUT_SECS
                        )),
                    });
                    return Ok(());
                }
            }
        }
    };

    // 消费流：先吃掉看门狗已取到的首块，再继续读后续（首块后不再重试）
    let mut buffer = String::new();
    let mut pending = Some(first_bytes);

    loop {
        let bytes = match pending.take() {
            Some(b) => b,
            None => match stream.next().await {
                Some(Ok(b)) => b,
                Some(Err(e)) => {
                    let _ = on_event.send(AiStreamEvent {
                        event: "error".to_string(),
                        data: Some(format!("Stream error: {}", e)),
                    });
                    return Ok(());
                }
                None => break,
            },
        };

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
            // 流末 usage：单独发 usage 事件（D-P1 token 用量统计），不进 chunk
            if let Some(usage) = extract_usage(&line) {
                let _ = on_event.send(AiStreamEvent {
                    event: "usage".to_string(),
                    data: Some(usage.to_string()),
                });
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

    #[test]
    fn body_omits_response_format_by_default() {
        let body = build_request_body("qwen-flash", "sys", "user", None);
        assert!(body.get("response_format").is_none());
        assert_eq!(body["model"], "qwen-flash");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["content"], "sys");
        assert_eq!(body["messages"][1]["content"], "user");
    }

    #[test]
    fn body_includes_response_format_when_requested() {
        let body = build_request_body("qwen-flash", "sys", "user", Some("json_object"));
        assert_eq!(body["response_format"]["type"], "json_object");
    }

    #[test]
    fn body_always_requests_usage_include() {
        let body = build_request_body("qwen-flash", "sys", "user", None);
        assert_eq!(body["stream_options"]["include_usage"], true);
    }

    #[test]
    fn extract_usage_pulls_normalized_tokens_from_final_chunk() {
        let line = r#"data: {"choices":[{"delta":{"content":""}}],"usage":{"prompt_tokens":42,"completion_tokens":17,"total_tokens":59}}"#;
        let usage = extract_usage(line).expect("应提取 usage");
        assert_eq!(usage["promptTokens"], 42);
        assert_eq!(usage["completionTokens"], 17);
        assert_eq!(usage["totalTokens"], 59);
    }

    #[test]
    fn extract_usage_accepts_camel_case_and_plain_lines() {
        let camel = r#"{"usage":{"promptTokens":1,"completionTokens":2,"totalTokens":3}}"#;
        let usage = extract_usage(camel).expect("应接受无 data: 前缀的行");
        assert_eq!(usage["totalTokens"], 3);
    }

    #[test]
    fn extract_usage_ignores_non_final_lines() {
        assert_eq!(extract_usage("data: [DONE]"), None);
        assert_eq!(
            extract_usage(r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#),
            None
        );
        assert_eq!(extract_usage("data: {not json"), None);
        assert_eq!(extract_usage(""), None);
    }

    #[test]
    fn retryable_only_on_5xx_and_429() {
        // 服务端错误 / 限流 → 可重试
        assert!(is_retryable_status(500));
        assert!(is_retryable_status(502));
        assert!(is_retryable_status(503));
        assert!(is_retryable_status(429));
        // 客户端错误 / 成功 → 不重试（重试也没用）
        assert!(!is_retryable_status(400));
        assert!(!is_retryable_status(401));
        assert!(!is_retryable_status(404));
        assert!(!is_retryable_status(200));
    }

    #[test]
    fn backoff_grows_with_attempt() {
        assert!(backoff_delay(2) > backoff_delay(1));
        assert!(backoff_delay(1) >= std::time::Duration::from_millis(1));
    }

    #[test]
    fn provider_kind_parses_known_values_and_defaults_to_dashscope() {
        assert_eq!(
            AiProviderKind::parse(Some("dashscope")),
            AiProviderKind::DashScope
        );
        assert_eq!(
            AiProviderKind::parse(Some("openai")),
            AiProviderKind::OpenAICompatible
        );
        // "deepseek" 是 openai 兼容组的别名
        assert_eq!(
            AiProviderKind::parse(Some("deepseek")),
            AiProviderKind::OpenAICompatible
        );
        assert_eq!(
            AiProviderKind::parse(Some("ollama")),
            AiProviderKind::Ollama
        );
        // 缺省 / 空白 / 未知值一律回退 DashScope（老客户端兼容）
        assert_eq!(AiProviderKind::parse(None), AiProviderKind::DashScope);
        assert_eq!(AiProviderKind::parse(Some("")), AiProviderKind::DashScope);
        assert_eq!(AiProviderKind::parse(Some("  ")), AiProviderKind::DashScope);
        assert_eq!(
            AiProviderKind::parse(Some("grok")),
            AiProviderKind::DashScope
        );
        // 标识与 as_str 往返一致
        for kind in [
            AiProviderKind::DashScope,
            AiProviderKind::OpenAICompatible,
            AiProviderKind::Ollama,
        ] {
            assert_eq!(AiProviderKind::parse(Some(kind.as_str())), kind);
        }
    }

    #[test]
    fn endpoint_dashscope_is_fixed_and_ignores_base_url() {
        assert_eq!(
            provider_endpoint(AiProviderKind::DashScope, Some("http://evil:1")),
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        );
        assert_eq!(
            provider_endpoint(AiProviderKind::DashScope, None),
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        );
    }

    #[test]
    fn endpoint_openai_uses_base_url_when_given_else_default() {
        assert_eq!(
            provider_endpoint(AiProviderKind::OpenAICompatible, Some(" https://x.dev/v1 ")),
            "https://x.dev/v1"
        );
        // 空白 base_url 视为未配置
        assert_eq!(
            provider_endpoint(AiProviderKind::OpenAICompatible, Some("  ")),
            "https://api.deepseek.com/chat/completions"
        );
        assert_eq!(
            provider_endpoint(AiProviderKind::OpenAICompatible, None),
            "https://api.deepseek.com/chat/completions"
        );
    }

    #[test]
    fn endpoint_ollama_appends_v1_and_uses_default_host() {
        assert_eq!(
            provider_endpoint(AiProviderKind::Ollama, Some("http://192.168.1.5:11434")),
            "http://192.168.1.5:11434/v1/chat/completions"
        );
        // 尾斜杠去除，避免双斜杠
        assert_eq!(
            provider_endpoint(AiProviderKind::Ollama, Some("http://127.0.0.1:11434/")),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
        assert_eq!(
            provider_endpoint(AiProviderKind::Ollama, None),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
    }

    #[test]
    fn provider_key_ollama_is_always_none() {
        // 即使传了 key / env / baked 也返回 None → 不挂 Authorization 头
        assert_eq!(
            provider_api_key(
                AiProviderKind::Ollama,
                Some("sk-x"),
                Some("env"),
                Some("baked")
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn provider_key_openai_uses_override_then_env_without_baked() {
        // baked 只属于 dashscope：openai 传 baked 也不该用它
        assert_eq!(
            provider_api_key(
                AiProviderKind::OpenAICompatible,
                Some("ov"),
                Some("env"),
                Some("baked")
            )
            .unwrap(),
            Some("ov".to_string())
        );
        assert_eq!(
            provider_api_key(
                AiProviderKind::OpenAICompatible,
                None,
                Some("env"),
                Some("baked")
            )
            .unwrap(),
            Some("env".to_string())
        );
        // 全覆盖缺失时报错（baked 不可作为 openai 兜底）
        assert!(
            provider_api_key(AiProviderKind::OpenAICompatible, None, None, Some("baked")).is_err()
        );
    }

    #[test]
    fn provider_default_model_differs_per_kind() {
        assert_eq!(
            provider_default_model(AiProviderKind::DashScope),
            "qwen-flash"
        );
        assert_eq!(
            provider_default_model(AiProviderKind::OpenAICompatible),
            "deepseek-chat"
        );
        assert_eq!(provider_default_model(AiProviderKind::Ollama), "llama3.1");
    }
}
