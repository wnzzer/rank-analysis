//! # 错误上报 / 可观测性模块
//!
//! 基于 [`tauri-plugin-sentry`](https://github.com/timfish/sentry-tauri) 接入 Sentry。
//! 插件会把前端（webview）的面包屑与事件经 Tauri IPC 转发给 Rust SDK 统一发送，
//! 因此 **前端无需任何额外 npm 依赖**，且 [`scrub_event`] 这一个 `before_send`
//! 钩子即可同时为前端 + 后端事件做 PII 脱敏（唯一卡点）。
//!
//! ## 隐私
//!
//! - 默认 `send_default_pii: false`，不附带 IP / Cookie。
//! - [`scrub_event`] 丢弃 `user` / `server_name`，并对消息、**异常正文**、面包屑、extra
//!   （含**嵌套数组 / 对象**）中的字符串做 [`redact_pii`]：覆盖 query / JSON / Debug 三种
//!   形态的 puuid / 召唤师名 / UUID。
//! - 局限：自由文本里无字段名上下文直接拼接的名字仍可能漏网——根本防线是默认关闭 +
//!   不在日志里拼接玩家名。
//!
//! ## 开关
//!
//! - **debug 构建**：默认开启，方便开发期验证。
//! - **release 构建**：默认关闭，用户需在「设置 → 常规」中开启 `errorReportingEnabled`
//!   （opt-in），重启后生效。

use regex::Regex;
use sentry::protocol::{Event, Value};
use std::sync::{Arc, LazyLock};

/// Sentry 项目的 DSN（公开 client key，设计上即随客户端分发）。
///
/// 可在编译期通过 `SENTRY_DSN` 环境变量覆盖（例如 fork 自建项目）。
pub const DEFAULT_DSN: &str =
    "https://4730d54dc96cffafff9dbd30d0699911@o4511465480060928.ingest.us.sentry.io/4511471007825920";

/// 配置中控制是否开启错误上报的键名（以 `Enabled` 结尾 → 默认 `false`）。
pub const REPORTING_KEY: &str = "errorReportingEnabled";

/// 解析最终使用的 DSN（环境变量优先）。
fn dsn() -> String {
    option_env!("SENTRY_DSN").unwrap_or(DEFAULT_DSN).to_string()
}

/// 判断当前是否应当开启错误上报。
///
/// debug 构建恒为 `true`；release 构建读取用户的 opt-in 配置。
pub fn reporting_enabled() -> bool {
    if cfg!(debug_assertions) {
        true
    } else {
        crate::config::read_bool_sync(REPORTING_KEY)
    }
}

/// 初始化 Sentry。
///
/// 返回的 [`sentry::ClientInitGuard`] 必须在应用整个生命周期内保持存活（在 `main`
/// 中持有到 `.run()` 返回），否则后台传输线程会提前关闭、事件丢失。
///
/// 未开启上报时返回 `None`，调用方据此跳过插件注册。
pub fn init() -> Option<sentry::ClientInitGuard> {
    if !reporting_enabled() {
        log::info!(
            "Sentry error reporting disabled (opt in via config key `{}`)",
            REPORTING_KEY
        );
        return None;
    }

    let guard = sentry::init((
        dsn(),
        sentry::ClientOptions {
            release: sentry::release_name!(),
            send_default_pii: false,
            before_send: Some(Arc::new(scrub_event)),
            // 国服网络下 sentry.io 常不可达：关闭时最多只等 1s flush（默认 2s），
            // 避免每次退出都顿挫。
            shutdown_timeout: std::time::Duration::from_secs(1),
            // 关闭 release health 的 session 上报，省掉启动/关闭的网络包；
            // 崩溃率统计对小项目意义不大，需要时再开。
            auto_session_tracking: false,
            ..Default::default()
        },
    ));
    log::info!("Sentry error reporting ENABLED");
    Some(guard)
}

/// `before_send` 钩子：在事件发送前移除 / 脱敏 PII。
///
/// 覆盖前端与后端的全部事件（前端事件经插件转发后也走这里）。
fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    // 主机名常包含用户真实姓名（如 "Zhang-MacBook"）；用户对象可能含 id / ip。
    event.server_name = None;
    event.user = None;

    if let Some(message) = event.message.take() {
        event.message = Some(redact_pii(&message));
    }

    for breadcrumb in &mut event.breadcrumbs.values {
        if let Some(message) = breadcrumb.message.take() {
            breadcrumb.message = Some(redact_pii(&message));
        }
        scrub_map(&mut breadcrumb.data);
    }

    // 异常正文（exception.values[*].value）是 capture_exception 与前端报错的主要载体，
    // 必须脱敏，否则报错文本里的 LCU URL / 玩家标识会绕过本钩子。
    for exception in &mut event.exception.values {
        if let Some(value) = exception.value.take() {
            exception.value = Some(redact_pii(&value));
        }
    }

    scrub_map(&mut event.extra);

    Some(event)
}

/// 递归脱敏一个 sentry `Map`（`event.extra` / `breadcrumb.data` 的顶层类型）。
fn scrub_map(map: &mut sentry::protocol::Map<String, Value>) {
    for value in map.values_mut() {
        redact_value(value);
    }
}

/// 递归脱敏任意 JSON 值：字符串就地脱敏，数组 / 对象逐元素递归。
///
/// breadcrumb.data 与 extra 常含嵌套数组 / 对象（如序列化后的请求体），
/// 只洗顶层会漏掉嵌套字符串里的 URL / UUID / 玩家标识。
fn redact_value(value: &mut Value) {
    match value {
        Value::String(s) => *s = redact_pii(s),
        Value::Array(items) => items.iter_mut().for_each(redact_value),
        Value::Object(obj) => obj.values_mut().for_each(redact_value),
        _ => {}
    }
}

/// 标准 UUID（如 LCU 部分接口中的 puuid）。
static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        .expect("valid uuid regex")
});

/// Riot puuid 等超长 token（base64url 风格，长度通常 ≥ 60）。
static LONG_TOKEN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z0-9_-]{60,}").expect("valid long-token regex"));

/// 按字段名脱敏，覆盖三种常见形态：
/// - URL query：`name=Faker`
/// - JSON：`"gameName": "Faker"`
/// - Rust Debug / snake_case：`summoner_name: "Faker"`
///
/// 组 1 = 字段名 + 分隔符(`:`/`=`) + 可选起始引号；组 2 = 值。只替换组 2，保留引号/分隔符。
static PII_PARAM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)("?\b(?:game_?name|tag_?line|summoner_?name|display_?name|riot_?id|puuid|account|name)"?\s*[:=]\s*"?)([^"&,\s}\])]+)"#,
    )
    .expect("valid pii-param regex")
});

/// 对单个字符串做 PII 脱敏。
///
/// 依次替换：按字段名（query / JSON / Debug）→ 标准 UUID → 超长 token。纯函数，便于单测。
///
/// 局限：无字段名上下文、直接拼进自由文本的名字（如 `format!("{} not found", name)`）
/// 无法识别——根本防线是默认关闭 + 不在日志里拼接玩家名。
pub fn redact_pii(input: &str) -> String {
    let step1 = PII_PARAM_RE.replace_all(input, "${1}<redacted>");
    let step2 = UUID_RE.replace_all(&step1, "<redacted-uuid>");
    let step3 = LONG_TOKEN_RE.replace_all(&step2, "<redacted-id>");
    step3.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_redact_standard_uuid() {
        let input = "/lol-summoner/v2/summoners/puuid/12345678-1234-1234-1234-123456789abc";
        let out = redact_pii(input);
        assert!(!out.contains("12345678-1234"));
        assert!(out.contains("<redacted-uuid>"));
    }

    #[test]
    fn should_redact_name_query_param() {
        let out = redact_pii("https://127.0.0.1/x?name=Faker%23KR1&region=kr");
        assert!(!out.contains("Faker"));
        assert!(out.contains("name=<redacted>"));
        // 非敏感参数保留
        assert!(out.contains("region=kr"));
    }

    #[test]
    fn should_redact_long_riot_puuid_token() {
        let token = "a".repeat(78);
        let out = redact_pii(&format!("puuid path /{}", token));
        assert!(!out.contains(&token));
        assert!(out.contains("<redacted-id>"));
    }

    #[test]
    fn should_leave_clean_text_untouched() {
        let input = "connection to LCU failed: timeout after 20s";
        assert_eq!(redact_pii(input), input);
    }

    #[test]
    fn should_redact_json_name_forms() {
        let out = redact_pii(r#"{"gameName": "Faker", "tagLine": "KR1", "level": 30}"#);
        assert!(!out.contains("Faker"), "gameName 应被脱敏: {out}");
        assert!(!out.contains("KR1"), "tagLine 应被脱敏: {out}");
        assert!(out.contains("level"), "非敏感字段应保留: {out}");
    }

    #[test]
    fn should_redact_debug_struct_name() {
        let out = redact_pii(r#"Summoner { summoner_name: "Faker", level: 30 }"#);
        assert!(!out.contains("Faker"), "Debug 形态的名字应被脱敏: {out}");
    }

    #[test]
    fn should_redact_nested_values() {
        // 覆盖嵌套对象 + 数组里的字符串
        let mut v = serde_json::json!({
            "req": { "url": "/lol?name=Faker&x=1" },
            "ids": ["12345678-1234-1234-1234-123456789abc"]
        });
        redact_value(&mut v);
        let s = v.to_string();
        assert!(!s.contains("Faker"), "嵌套对象里的名字应被脱敏: {s}");
        assert!(
            !s.contains("12345678-1234"),
            "嵌套数组里的 uuid 应被脱敏: {s}"
        );
    }

    #[test]
    fn should_scrub_exception_values() {
        let mut event = Event::default();
        event.exception.values.push(sentry::protocol::Exception {
            value: Some("failed for 12345678-1234-1234-1234-123456789abc".to_string()),
            ..Default::default()
        });
        let scrubbed = scrub_event(event).expect("event kept");
        let val = scrubbed.exception.values[0]
            .value
            .as_ref()
            .expect("value present");
        assert!(
            val.contains("<redacted-uuid>"),
            "异常正文里的 uuid 应被脱敏: {val}"
        );
    }
}
