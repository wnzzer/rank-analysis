//! # Riot 开发者 API 接入（riot，M1 支线）
//!
//! 用用户自备的 **Riot personal key** 走官方 `match-v5` 拉对局时间线，作为
//! L3 归因的四级降级链（LCU→SGP→OP.GG→L2 规则）之外的**独立校验源**
//! （路线图 v1.3 §4b / §5.5）：国服 SGP timeline 缺字段（如 vision）时，
//! match-v5 是唯一能补全的官方通道。
//!
//! **限流纪律**：dev key 官方限速为 20 req/s 与 100 req/2min，双层令牌桶
//! （[`rate_limit`]）恒生效；production key 参数经 config 可配。限流不可
//! 阻塞主流程——超限即报"稍后再试"并让 L3 走降级链。
//!
//! key 存放：`settings.riot.apiKey`（config 点分路径，见 `crate::config`）。

use std::sync::{LazyLock, Mutex};

use reqwest::header::HeaderMap;
use serde_json::Value;

pub mod rate_limit;

use rate_limit::RateLimiter;

/// config 中 Riot API key 的存储路径。
pub const RIOT_API_KEY_CONFIG: &str = "settings.riot.apiKey";

/// 双层限流器（dev key 官方限速：20 req/s + 100 req/2min）。
static LIMITER: LazyLock<Mutex<RateLimiter>> = LazyLock::new(|| {
    Mutex::new(RateLimiter::new(
        20,
        20.0, // burst：20 req/s
        100,
        100.0 / 120.0, // sustained：100 req / 2min
    ))
});

/// match-v5 响应里本工具关心的字段（骨架解析，完整性留 M2 对齐后补）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiotMatchDetail {
    pub metadata: Option<Value>,
    pub info: Option<Value>,
}

/// 拉取一局 match-v5 详情（骨架：限流 → 鉴权 GET → 粗解析）。
///
/// - key 未配置 → 明确报错（提示去开发者后台生成 personal key），不静默。
/// - 超限 → 报"限流"错误，调用方转降级链（不阻塞、不排队）。
pub async fn get_match_detail(
    platform_id: &str,
    match_id: &str,
) -> Result<RiotMatchDetail, String> {
    let key = crate::config::get_config(RIOT_API_KEY_CONFIG)
        .await
        .map_err(|e| format!("读取 Riot API key 失败: {e}"))?;
    let key = match key {
        crate::config::Value::String(s) if !s.is_empty() => s,
        _ => return Err("未配置 Riot API key（settings.riot.apiKey）".to_string()),
    };

    {
        let limiter = LIMITER.lock().unwrap_or_else(|e| e.into_inner());
        if !limiter.try_acquire(std::time::Instant::now()) {
            return Err("Riot 限流（20 req/s / 100 req/2min），请稍后再试".to_string());
        }
    }

    let url = format!("https://{platform_id}.api.riotgames.com/lol/match/v5/matches/{match_id}");
    let mut headers = HeaderMap::new();
    headers.insert(
        "X-Riot-Token",
        key.parse()
            .map_err(|_| "Riot API key 格式非法".to_string())?,
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Riot match-v5 请求失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!(
            "Riot match-v5 非 2xx（{status}）——请检查 key 权限与 match 所属区服"
        ));
    }
    let detail: RiotMatchDetail = resp
        .json()
        .await
        .map_err(|e| format!("Riot match-v5 反序列化失败: {e}"))?;
    Ok(detail)
}
