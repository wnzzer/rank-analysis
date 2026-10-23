//! # AI 分析命令模块
//!
//! 提供流式 AI 分析功能，两个 provider：
//!
//! ## 主要功能
//!
//! - **流式 AI 请求**: 通过 Tauri Channel 实现 SSE 流式输出到前端
//! - **DashScope (阿里云，默认 DeepSeek)**: 直连 OpenAI 兼容端点，密钥在 Rust 层解析（见 resolve_api_key）
//! - **Claude**: 经 Oracle 中转（`relay/claude-relay`）。客户端不内置 Anthropic key，
//!   中转按出口 IP 做区域门控（见 [`check_claude_region`]），并把 Anthropic 流转成与
//!   DashScope 相同的 SSE 行格式，故两者共用同一套流解析
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

/// Claude 中转默认地址：Oracle 上 Caddy 终结 TLS（443 被 xray 占用故走 8443）。
/// 用域名而非 IP：换服务器只改 DNS，收不到更新的老版本也不受影响。
/// 可被编译期 / 运行时 `CLAUDE_RELAY_URL` 覆盖，方便本地起中转调试。
const DEFAULT_CLAUDE_RELAY_URL: &str = "https://oracle.nuliyangguang.top:8443";

/// 中转地址：运行时环境变量 > 编译期注入 > 默认值（末尾 `/` 去掉）
fn claude_relay_url() -> String {
    std::env::var("CLAUDE_RELAY_URL")
        .ok()
        .or_else(|| option_env!("CLAUDE_RELAY_URL").map(str::to_string))
        .unwrap_or_else(|| DEFAULT_CLAUDE_RELAY_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

/// 发往 Claude 中转的 User-Agent。中转只放行 `rank-analysis/` 前缀，挡掉浏览器 / 脚本随手扫来的请求
/// （UA 可伪造，只是第一道筛子；真正的鉴权靠 `CLAUDE_RELAY_TOKEN`）
const RELAY_USER_AGENT: &str = concat!("rank-analysis/", env!("CARGO_PKG_VERSION"));

/// 进程内共享的 HTTP 客户端。
///
/// 连接池挂在 `Client` 实例上：每次请求新建 `Client` 等于每次拿一个空池、用完即丢，
/// 永远在重新握手（到美东中转一次 TCP+TLS 握手就是数百毫秒）。共享后空闲连接留在池里
/// 复用，配合 [`prewarm_claude_relay`] 在用户点「AI 分析」前就把连接建好。
/// 超时按请求设（`RequestBuilder::timeout`），不同 provider 不必各建一个客户端。
fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(RELAY_USER_AGENT)
            // 略短于中转端连接空闲超时（server.py 的 Handler.timeout = 120s），
            // 避免复用一条对端刚关掉的连接
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("build reqwest client")
    })
}

/// AI 服务提供方
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Provider {
    DashScope,
    Claude,
}

impl Provider {
    /// 前端传 `"claude"` 走 Claude，其余（含缺省）都走 DashScope，老前端不受影响
    fn parse(s: Option<&str>) -> Self {
        match s {
            Some("claude") => Provider::Claude,
            _ => Provider::DashScope,
        }
    }

    /// 总请求超时。Opus 5.5 思考恒开、输出也更长，60s 会截断长复盘
    fn request_timeout(self) -> Duration {
        Duration::from_secs(match self {
            Provider::DashScope => REQUEST_TIMEOUT_SECS,
            Provider::Claude => 180,
        })
    }
}

/// 前端未指定 model 时的兜底：与远程模型配置的编译期默认一致（选型依据见 `ai_config`）。
const DEFAULT_MODEL: &str = crate::ai_config::DEFAULT_MODEL;

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

/// 从一行 SSE 提取流内错误（Claude 中转在流已开始后出错时发
/// `data: {"error":{"message":"..."}}`）。其余行返回 `None`。纯函数，便于单测。
fn extract_stream_error(line: &str) -> Option<String> {
    let data = line.trim().strip_prefix("data: ")?.trim();
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    json.get("error")?
        .get("message")?
        .as_str()
        .map(str::to_string)
}

/// 非 2xx 响应体转成给用户看的错误：`{"error":{"message":"..."}}` 形态（中转 / DashScope
/// 都是）取 message，否则原样带上状态码与正文。纯函数，便于单测。
fn format_http_error(status: u16, body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.get("message")?.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("API error ({}): {}", status, body))
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
/// 恒带 `enable_thinking: false`：deepseek-v4.1 / qwen3.8 等混合思考模型默认先吐一段
/// reasoning_content（实测），而 `extract_delta_content` 只转发 content，用户会干等
/// 推理结束才见首字。非混合模型（如 qwen-flash）DashScope 忽略该字段。
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
        "enable_thinking": false
    });
    if let Some(fmt) = response_format {
        body["response_format"] = json!({ "type": fmt });
    }
    body
}

/// 构建 Claude 中转请求体（中转接口见 `relay/claude-relay/server.py`）。纯函数，便于单测。
///
/// 中转只收原始 prompt，Anthropic 侧参数（effort / max_tokens / fallbacks）由服务端统一定，
/// 调参不用发客户端版本。`json_mode` 时中转在 system 末尾追加「只输出 JSON」约束。
fn build_claude_relay_body(
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    json_mode: bool,
) -> serde_json::Value {
    json!({
        "model": model,
        "system": system_prompt,
        "prompt": user_prompt,
        "jsonMode": json_mode
    })
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
    /// 缺省不传该字段（普通文本/markdown 输出）。Claude 下转为中转的 `jsonMode`。
    pub response_format: Option<String>,
    /// `"claude"` 走 Claude 中转；缺省 / 其他值走 DashScope
    pub provider: Option<String>,
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
    let provider = Provider::parse(request.provider.as_deref());
    let model = request
        .model
        .as_deref()
        .unwrap_or(DEFAULT_MODEL)
        .to_string();

    // 注意：canonical 系统提示词在前端 `stream.ts` 的 `DEFAULT_SYSTEM_PROMPT`，
    // 所有调用路径都会带上非空 systemPrompt，下面仅是 systemPrompt 缺省时的兜底，
    // 不要在此处维护"权威"提示词（避免与前端分叉）。
    let system_prompt = request
        .system_prompt
        .unwrap_or_else(|| "你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁、专业、直接的中文回复。".to_string());

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let (url, body) = match provider {
        Provider::DashScope => {
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
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", key))
                    .map_err(|e| format!("Invalid API key: {}", e))?,
            );
            let body = build_request_body(
                &model,
                &system_prompt,
                &request.prompt,
                request.response_format.as_deref(),
            );
            (DASHSCOPE_URL.to_string(), body)
        }
        Provider::Claude => {
            headers.insert(
                "X-Device-ID",
                HeaderValue::from_str(&crate::observability::current_device_id())
                    .map_err(|e| format!("Invalid device ID: {}", e))?,
            );
            // 用户自带 key 则随请求带给中转（不占内置额度）；留空用中转持有的官方 key
            if let Some(k) = request
                .api_key
                .as_deref()
                .map(str::trim)
                .filter(|k| !k.is_empty())
            {
                headers.insert(
                    "X-User-Key",
                    HeaderValue::from_str(k).map_err(|e| format!("Invalid API key: {}", e))?,
                );
            }
            // 中转鉴权 token 编译期注入（CI 读仓库 Secret）。本地 `tauri dev` 想用 Claude，
            // 需在编译前 export CLAUDE_RELAY_TOKEN，否则中转回 401「客户端未授权」
            if let Some(token) = option_env!("CLAUDE_RELAY_TOKEN") {
                headers.insert(
                    "X-Relay-Token",
                    HeaderValue::from_str(token).map_err(|e| e.to_string())?,
                );
            }
            let body = build_claude_relay_body(
                &model,
                &system_prompt,
                &request.prompt,
                request.response_format.is_some(),
            );
            (format!("{}/v1/chat", claude_relay_url()), body)
        }
    };

    let client = http_client();

    use futures::StreamExt;

    // 首块到达前可重试：建连失败 / 可重试状态码 / 首字看门狗超时都算"流未开始"，
    // 退避后再试。一旦拿到首个响应字节（已视为开始流），跳出循环，后续不再重试，
    // 避免向前端重复 emit chunk。
    let (mut stream, first_bytes) = {
        let mut attempt = 0u32;
        loop {
            attempt += 1;

            let response = match client
                .post(&url)
                // 总超时按 provider 收紧（含流式全程）
                .timeout(provider.request_timeout())
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
                // 中转的 429 是它自己的限流（上游 429 SDK 已重试过），再试只会多扣一次额度
                let relay_limited = provider == Provider::Claude && status.as_u16() == 429;
                if is_retryable_status(status.as_u16()) && !relay_limited && attempt < MAX_ATTEMPTS
                {
                    tokio::time::sleep(backoff_delay(attempt)).await;
                    continue;
                }
                let error_text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                let _ = on_event.send(AiStreamEvent {
                    event: "error".to_string(),
                    data: Some(format_http_error(status.as_u16(), &error_text)),
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

            if let Some(err) = extract_stream_error(&line) {
                let _ = on_event.send(AiStreamEvent {
                    event: "error".to_string(),
                    data: Some(err),
                });
                return Ok(());
            }
            if let Some(content) = extract_delta_content(&line) {
                let _ = on_event.send(AiStreamEvent {
                    event: "chunk".to_string(),
                    data: Some(content),
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

/// Claude 区域检测结果（由中转按本机出口 IP 判定）
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRegion {
    /// ISO 国家码；中转查不到 / 请求失败时为 `None`
    pub country: Option<String>,
    /// 是否可用 Claude
    pub allowed: bool,
    /// 检测失败原因（中转不可达等）；成功判定时为 `None`
    pub error: Option<String>,
}

/// 区域检测成功结果的缓存时长：出口 IP 很少变，切 VPN 后用户可在设置里手动重测
const REGION_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

static REGION_CACHE: std::sync::Mutex<Option<(std::time::Instant, ClaudeRegion)>> =
    std::sync::Mutex::new(None);

async fn fetch_claude_region() -> ClaudeRegion {
    #[derive(Deserialize)]
    struct Resp {
        country: Option<String>,
        allowed: bool,
    }
    let fail = |e: String| ClaudeRegion {
        country: None,
        allowed: false,
        error: Some(e),
    };
    match http_client()
        .get(format!("{}/v1/region", claude_relay_url()))
        .header("X-Device-ID", crate::observability::current_device_id())
        .timeout(Duration::from_secs(8))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Resp>().await {
            Ok(r) => ClaudeRegion {
                country: r.country,
                allowed: r.allowed,
                error: None,
            },
            Err(e) => fail(format!("区域检测响应异常: {}", e)),
        },
        Err(e) => fail(format!("连接 Claude 中转失败: {}", e)),
    }
}

/// 检测当前网络能否使用 Claude（Anthropic 未提供服务的地区不可用）。
///
/// 判定在 Oracle 中转做（按请求出口 IP 查国家），与真正发请求时中转的门控同一口径。
/// 成功结果缓存 [`REGION_CACHE_TTL`]；失败不缓存，下次调用重试。
///
/// # 参数
/// - `force`: true 时跳过缓存重新检测（设置页「重新检测」按钮）
#[tauri::command]
pub async fn check_claude_region(force: Option<bool>) -> ClaudeRegion {
    if !force.unwrap_or(false) {
        if let Some((at, cached)) = REGION_CACHE.lock().unwrap().as_ref() {
            if at.elapsed() < REGION_CACHE_TTL {
                return cached.clone();
            }
        }
    }
    let region = fetch_claude_region().await;
    let mut cache = REGION_CACHE.lock().unwrap();
    *cache = region
        .error
        .is_none()
        .then(|| (std::time::Instant::now(), region.clone()));
    region
}

/// 预热到 Claude 中转的连接：打一下 `/healthz`，把建好的连接留在共享连接池里，
/// 用户随后点「AI 分析」时直接复用、省掉握手。
///
/// 前端在打开含 AI 分析入口的页面时调用（仅用户选了 Claude 时）。失败静默忽略——
/// 预热只是优化，真正请求时会照常建连。
#[tauri::command]
pub async fn prewarm_claude_relay() {
    let _ = http_client()
        .get(format!("{}/healthz", claude_relay_url()))
        .timeout(Duration::from_secs(8))
        .send()
        .await;
}

/// 取远程 AI 模型配置（场景 → 模型名）。
///
/// 永不失败：拉取 / 校验失败时返回最后已知配置或编译期默认值（见 `ai_config` 降级链）。
/// 前端按场景取模型，缺省回落 `default`。
#[tauri::command]
pub async fn get_ai_config() -> crate::ai_config::AiConfig {
    (*crate::ai_config::get_or_fetch().await).clone()
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
    fn body_always_disables_thinking() {
        // 混合思考模型不关思考会先输出整段推理，首字延迟成倍增加
        let body = build_request_body("deepseek-v4.1-flash-1017", "sys", "user", None);
        assert_eq!(body["enable_thinking"], false);
    }

    #[test]
    fn body_includes_response_format_when_requested() {
        let body = build_request_body("qwen-flash", "sys", "user", Some("json_object"));
        assert_eq!(body["response_format"]["type"], "json_object");
    }

    #[test]
    fn relay_user_agent_has_app_prefix() {
        // 与 relay/claude-relay/server.py 的 REQUIRED_UA_PREFIX 对应，改一边要同步另一边
        assert!(RELAY_USER_AGENT.starts_with("rank-analysis/"));
    }

    #[test]
    fn provider_parse_defaults_to_dashscope() {
        assert_eq!(Provider::parse(Some("claude")), Provider::Claude);
        assert_eq!(Provider::parse(Some("dashscope")), Provider::DashScope);
        assert_eq!(Provider::parse(None), Provider::DashScope);
        assert_eq!(Provider::parse(Some("whatever")), Provider::DashScope);
    }

    #[test]
    fn claude_body_carries_prompt_and_json_mode() {
        let body = build_claude_relay_body("claude-opus-5-5", "sys", "user", true);
        assert_eq!(body["model"], "claude-opus-5-5");
        assert_eq!(body["system"], "sys");
        assert_eq!(body["prompt"], "user");
        assert_eq!(body["jsonMode"], true);
    }

    #[test]
    fn stream_error_line_is_extracted() {
        let line = r#"data: {"error": {"message": "Claude API Key 无效"}}"#;
        assert_eq!(
            extract_stream_error(line),
            Some("Claude API Key 无效".to_string())
        );
        // 正常增量 / 结束 / 注释行都不是错误
        assert_eq!(
            extract_stream_error(r#"data: {"choices":[{"delta":{"content":"x"}}]}"#),
            None
        );
        assert_eq!(extract_stream_error("data: [DONE]"), None);
        assert_eq!(extract_stream_error(": started"), None);
    }

    #[test]
    fn http_error_prefers_json_message() {
        assert_eq!(
            format_http_error(
                403,
                r#"{"error": {"message": "当前地区（CN）不在 Claude 服务范围内"}}"#
            ),
            "当前地区（CN）不在 Claude 服务范围内"
        );
        assert_eq!(
            format_http_error(502, "bad gateway"),
            "API error (502): bad gateway"
        );
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
}
