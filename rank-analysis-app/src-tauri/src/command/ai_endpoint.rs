//! # AI 接入点探测命令
//!
//! 设置页「AI 模型」用的两个辅助命令，都只读、不落盘：
//!
//! - [`list_ai_models`]: 拉接入点的模型列表（`GET {base}/models`），给默认模型的下拉框用
//! - [`test_ai_endpoint`]: 用当前填的地址 / 密钥 / 模型发一条最短的对话，告诉用户通不通
//!
//! 走后端而不是在前端直接 fetch：不受浏览器跨域限制，内置密钥也不必暴露给前端。
//!
//! ## 内置密钥只发给内置地址
//!
//! 调用方不传密钥时，只有目标恰好是内置的阿里云地址才会带上内置密钥（见 [`resolve_target`]）。
//! 否则用户随手填一个地址点「测试」，就能把内置密钥骗到别人的服务器上。

use super::ai::{
    api_key, chat_url, format_http_error, http_client, is_dashscope_host, validate_base_url,
    DASHSCOPE_BASE_URL,
};
use reqwest::header::AUTHORIZATION;
use serde::Serialize;
use serde_json::json;
use std::time::{Duration, Instant};

/// 拉模型列表的超时
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
/// 测试连接的超时
const TEST_TIMEOUT: Duration = Duration::from_secs(15);
/// 返回给前端的错误文本上限（字符数）：有的网关会把整页 HTML 当错误正文回来
const MAX_ERROR_CHARS: usize = 300;

/// 模型名里出现这些词的不是对话模型，从下拉列表里去掉。
/// 尽力而为：各家命名没有规范，漏网的用户不选就是了，误杀的可以手动输入。
const NON_CHAT_MARKERS: &[&str] = &[
    "embedding",
    "rerank",
    "tts",
    "asr",
    "image",
    "video",
    "audio",
    "ocr",
];

/// 解析出实际要访问的地址与密钥。纯函数（内置密钥经 `builtin_key` 注入），便于单测。
///
/// - 地址缺省 / 空白 → 内置的阿里云地址
/// - 密钥缺省 / 空白 → 仅当地址是内置地址时用内置密钥，否则不带密钥（本机模型不需要）
fn resolve_target(
    base_url: Option<&str>,
    user_key: Option<&str>,
    builtin_key: impl FnOnce() -> Result<String, String>,
) -> Result<(String, Option<String>), String> {
    let base = match base_url.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => validate_base_url(raw)?,
        None => DASHSCOPE_BASE_URL.to_string(),
    };
    let key = match user_key.map(str::trim).filter(|s| !s.is_empty()) {
        Some(k) => Some(k.to_string()),
        None if base == DASHSCOPE_BASE_URL => Some(builtin_key()?),
        None => None,
    };
    Ok((base, key))
}

/// 从 `GET /models` 的响应里取出对话模型的名字：去掉非对话模型、去重、排序。纯函数，便于单测。
fn chat_model_ids(body: &serde_json::Value) -> Vec<String> {
    let mut ids: Vec<String> = body
        .get("data")
        .and_then(|d| d.as_array())
        .into_iter()
        .flatten()
        .filter_map(|m| m.get("id")?.as_str())
        .filter(|id| {
            let lower = id.to_lowercase();
            !id.trim().is_empty() && !NON_CHAT_MARKERS.iter().any(|w| lower.contains(w))
        })
        .map(str::to_string)
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// 把错误文本截到 [`MAX_ERROR_CHARS`] 个字符（按字符截，不会切坏中文）。纯函数，便于单测。
fn truncate_error(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() <= MAX_ERROR_CHARS {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(MAX_ERROR_CHARS).collect();
    cut.push('…');
    cut
}

/// 把 reqwest 的错误翻成用户能看懂的话
fn describe_send_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "连接超时".to_string()
    } else if e.is_connect() {
        format!("连不上接入点：{}", e)
    } else {
        format!("请求失败：{}", e)
    }
}

/// 拉接入点的模型列表
///
/// # 参数
/// - `base_url`: 接入点地址（到 `/v1` 为止）；缺省为内置的阿里云地址
/// - `api_key`: 密钥；缺省时仅内置地址会用内置密钥
///
/// # 返回
/// 对话模型的名字（已过滤、排序）。接入点不提供 `/models` 或请求失败时返回 `Err`，
/// 前端据此把下拉框退化成纯输入框。
#[tauri::command]
pub async fn list_ai_models(
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let (base, key) = resolve_target(base_url.as_deref(), api_key.as_deref(), api_key_builtin)?;
    let mut req = http_client()
        .get(format!("{}/models", base))
        .timeout(LIST_TIMEOUT);
    if let Some(k) = key {
        req = req.header(AUTHORIZATION, format!("Bearer {}", k));
    }
    let resp = req.send().await.map_err(|e| describe_send_error(&e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(truncate_error(&format_http_error(status.as_u16(), &text)));
    }
    let body: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "模型列表的响应不是 JSON".to_string())?;
    Ok(chat_model_ids(&body))
}

/// 测试连接的结果
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EndpointTest {
    /// 是否可用
    pub ok: bool,
    /// 耗时（毫秒）
    pub ms: u64,
    /// 失败原因（服务商的错误文本，已截断）；成功时为 `None`
    pub error: Option<String>,
}

/// 构建测试连接的请求体：一条最短的非流式对话。纯函数，便于单测。
///
/// `limit_tokens` 为 false 时不带 `max_tokens`——部分新模型只认 `max_completion_tokens`，
/// 带了反而 400（见 [`test_ai_endpoint`] 的重试）。
fn build_test_body(model: &str, dashscope: bool, limit_tokens: bool) -> serde_json::Value {
    let mut body = json!({
        "model": model,
        "messages": [{ "role": "user", "content": "hi" }],
        "stream": false
    });
    if limit_tokens {
        body["max_tokens"] = json!(1);
    }
    if dashscope {
        // 阿里云的混合思考模型在非流式调用下必须显式关思考，否则直接报错
        body["enable_thinking"] = json!(false);
    }
    body
}

/// 内置密钥（环境变量 / 编译期注入）
fn api_key_builtin() -> Result<String, String> {
    api_key(None)
}

/// 用给定的地址 / 密钥 / 模型发一条最短的对话，测试接入点是否可用
///
/// # 参数
/// - `base_url`: 接入点地址；缺省为内置的阿里云地址
/// - `api_key`: 密钥；缺省时仅内置地址会用内置密钥
/// - `model`: 要测的模型名
///
/// # 返回
/// 永不 `Err`：地址不合法、连不上、服务商报错都体现在 `ok = false` 与 `error` 里。
#[tauri::command]
pub async fn test_ai_endpoint(
    base_url: Option<String>,
    api_key: Option<String>,
    model: String,
) -> EndpointTest {
    let started = Instant::now();
    let done = |error: Option<String>| EndpointTest {
        ok: error.is_none(),
        ms: started.elapsed().as_millis() as u64,
        error: error.map(|e| truncate_error(&e)),
    };

    let model = model.trim();
    if model.is_empty() {
        return done(Some("未填写模型名".to_string()));
    }
    let (base, key) = match resolve_target(base_url.as_deref(), api_key.as_deref(), api_key_builtin)
    {
        Ok(t) => t,
        Err(e) => return done(Some(e)),
    };
    let dashscope = is_dashscope_host(&base);

    // 最多两次：第一次带 max_tokens；被以 max_tokens 为由拒绝时去掉再试
    for limit_tokens in [true, false] {
        let mut req = http_client()
            .post(chat_url(&base))
            .timeout(TEST_TIMEOUT)
            .json(&build_test_body(model, dashscope, limit_tokens));
        if let Some(k) = &key {
            req = req.header(AUTHORIZATION, format!("Bearer {}", k));
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => return done(Some(describe_send_error(&e))),
        };
        let status = resp.status();
        if status.is_success() {
            return done(None);
        }
        let text = resp.text().await.unwrap_or_default();
        if limit_tokens && status.is_client_error() && text.contains("max_tokens") {
            continue;
        }
        return done(Some(format_http_error(status.as_u16(), &text)));
    }
    done(Some("接入点拒绝了请求".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builtin() -> Result<String, String> {
        Ok("builtin-key".to_string())
    }

    #[test]
    fn target_defaults_to_builtin_endpoint_with_builtin_key() {
        assert_eq!(
            resolve_target(None, None, builtin).unwrap(),
            (
                DASHSCOPE_BASE_URL.to_string(),
                Some("builtin-key".to_string())
            )
        );
        // 空白等同于没填
        assert_eq!(
            resolve_target(Some("  "), Some(" "), builtin).unwrap(),
            (
                DASHSCOPE_BASE_URL.to_string(),
                Some("builtin-key".to_string())
            )
        );
    }

    #[test]
    fn builtin_key_never_goes_to_another_endpoint() {
        // 用户填了别的地址但没填密钥：不带密钥，绝不把内置密钥发过去
        let (base, key) = resolve_target(Some("https://api.example.com/v1"), None, || {
            panic!("不该去取内置密钥")
        })
        .unwrap();
        assert_eq!(base, "https://api.example.com/v1");
        assert_eq!(key, None);
        // 阿里云的另一个地址（国际站）也不是内置地址
        let (_, key) = resolve_target(
            Some("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
            None,
            || panic!("不该去取内置密钥"),
        )
        .unwrap();
        assert_eq!(key, None);
    }

    #[test]
    fn builtin_endpoint_spelled_out_still_gets_builtin_key() {
        // 末尾多个斜杠规整后仍是内置地址
        let (_, key) = resolve_target(
            Some("https://dashscope.aliyuncs.com/compatible-mode/v1/"),
            None,
            builtin,
        )
        .unwrap();
        assert_eq!(key, Some("builtin-key".to_string()));
    }

    #[test]
    fn user_key_wins_and_is_trimmed() {
        let (_, key) = resolve_target(None, Some("  sk-user  "), || {
            panic!("有用户密钥时不该取内置密钥")
        })
        .unwrap();
        assert_eq!(key, Some("sk-user".to_string()));
    }

    #[test]
    fn target_rejects_invalid_url_and_missing_builtin_key() {
        assert!(resolve_target(Some("http://api.example.com/v1"), None, builtin).is_err());
        assert!(resolve_target(None, None, || Err("未配置".to_string())).is_err());
    }

    #[test]
    fn model_list_filters_sorts_and_dedups() {
        let body = json!({
            "data": [
                { "id": "qwen-plus" },
                { "id": "text-embedding-v4" },
                { "id": "gte-rerank-v2" },
                { "id": "qwen-TTS-latest" },
                { "id": "wan-video-2" },
                { "id": "deepseek-chat" },
                { "id": "qwen-plus" },
                { "id": "" },
                { "name": "no-id" }
            ]
        });
        assert_eq!(chat_model_ids(&body), vec!["deepseek-chat", "qwen-plus"]);
    }

    #[test]
    fn model_list_tolerates_unexpected_shapes() {
        assert!(chat_model_ids(&json!({})).is_empty());
        assert!(chat_model_ids(&json!({ "data": "nope" })).is_empty());
        assert!(chat_model_ids(&json!([1, 2])).is_empty());
    }

    #[test]
    fn error_is_truncated_by_chars() {
        assert_eq!(truncate_error("  短错误  "), "短错误");
        let long = "错".repeat(MAX_ERROR_CHARS + 50);
        let cut = truncate_error(&long);
        assert_eq!(cut.chars().count(), MAX_ERROR_CHARS + 1);
        assert!(cut.ends_with('…'));
        // 恰好等于上限时不截
        let exact = "a".repeat(MAX_ERROR_CHARS);
        assert_eq!(truncate_error(&exact), exact);
    }

    #[test]
    fn test_body_is_minimal_and_host_aware() {
        let body = build_test_body("qwen-plus", true, true);
        assert_eq!(body["model"], "qwen-plus");
        assert_eq!(body["max_tokens"], 1);
        assert_eq!(body["stream"], false);
        assert_eq!(body["enable_thinking"], false);

        let other = build_test_body("gpt-x", false, false);
        assert!(other.get("enable_thinking").is_none());
        assert!(other.get("max_tokens").is_none());
    }
}
