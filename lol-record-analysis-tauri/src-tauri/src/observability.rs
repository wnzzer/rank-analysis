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
//! - [`scrub_event`] 把 `user` 收敛到只保留匿名 `id`（见 [`device_id`]），丢弃 `server_name`
//!   （Windows 上常是用户自定义机名 / 昵称），并对消息、**异常正文**、面包屑、extra
//!   （含**嵌套数组 / 对象**）中的字符串做 [`redact_pii`]：覆盖 query / JSON / Debug 三种
//!   形态的 puuid / 召唤师名 / UUID。
//! - [`scrub_log`] 移除 Logs attribute 里的 `server.address`（hostname 从这条管道漏过，
//!   `scrub_event` 不覆盖），并对 `body` 跑 [`redact_pii`]。
//! - 局限：自由文本里无字段名上下文直接拼接的名字仍可能漏网——根本防线是默认关闭 +
//!   不在日志里拼接玩家名。
//!
//! ## 匿名设备 ID
//!
//! 每台机器首次启用上报时生成一个 UUIDv4，写入 [`DEVICE_ID_FILE`]，后续启动复用。
//! 通过 `scope.user.id` 注入，errors / logs 两条管道都能据此用 `count_unique(user)`
//! 算 DAU，无需上报 IP / hostname。
//!
//! ## 开关
//!
//! - **debug 构建**：默认开启，方便开发期验证。
//! - **release 构建**：默认关闭，用户需在「设置 → 常规」中开启 `errorReportingEnabled`
//!   （opt-in），重启后生效。
//! - 无论开关如何，未配置 `SENTRY_DSN`（[`dsn`]）时上报静默关闭——fork 自建须自带
//!   DSN，否则不会误报到上游项目。

use regex::Regex;
use sentry::protocol::{Event, Log, User, Value};
use std::path::Path;
use std::sync::{Arc, LazyLock};

/// 配置中控制是否开启错误上报的键名（以 `Enabled` 结尾 → 默认 `false`）。
pub const REPORTING_KEY: &str = "errorReportingEnabled";

/// 持久化匿名设备 ID 的文件名（与 `config.yaml` 同目录，相对 CWD）。
pub const DEVICE_ID_FILE: &str = "device_id";

/// 解析最终使用的 Sentry DSN：运行时环境变量（开发/测试）→ `option_env!` 编译期注入（线上 CI）。
///
/// **DSN 不再硬编码进源码**：官方构建由 CI 在 `tauri build` 时设 `SENTRY_DSN`
/// （与 `DASHSCOPE_API_KEY` 同款套路，见 `.github/workflows/release.yml`），明文不进 git。
/// fork 未配置 `SENTRY_DSN` 时解析为 `None` → 上报直接关闭，崩溃不会误灌到上游项目。
fn dsn() -> Option<String> {
    std::env::var("SENTRY_DSN")
        .ok()
        .or_else(|| option_env!("SENTRY_DSN").map(str::to_string))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
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

    let Some(dsn) = dsn() else {
        log::info!(
            "Sentry error reporting disabled: no SENTRY_DSN configured \
             (set the SENTRY_DSN env var at build time to enable)"
        );
        return None;
    };

    let device_id = device_id(Path::new(DEVICE_ID_FILE));
    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some(format!("lol-record-analysis-app@{}", env!("APP_VERSION")).into()),
            send_default_pii: false,
            before_send: Some(Arc::new(scrub_event)),
            // 结构化日志（Sentry Logs）：把 `log` 记录转发上去（见 main.rs 的 SentryLogger）。
            // 全量转发包含 info，日志正文可能含 LCU 令牌 / 配置转储 / puuid，
            // 必须经 before_send_log 脱敏后再发。
            enable_logs: true,
            before_send_log: Some(Arc::new(scrub_log)),
            // 国服网络下 sentry.io 常不可达：关闭时最多只等 1s flush（默认 2s），
            // 避免每次退出都顿挫。
            shutdown_timeout: std::time::Duration::from_secs(1),
            // Release Health 会话：Sentry 原生的 DAU / WAU / 版本采用率 / crash-free
            // 数据源（每次启动一个 session，配合 user.id 去重出活跃用户）。
            auto_session_tracking: true,
            session_mode: sentry::SessionMode::Application,
            // 维度：debug / release 分环境，Sentry 侧所有面板都可按此过滤，
            // 开发期自己的会话不再污染真实用户数据。
            environment: Some(
                if cfg!(debug_assertions) {
                    "debug"
                } else {
                    "release"
                }
                .into(),
            ),
            ..Default::default()
        },
    ));
    // 设置匿名设备 ID 到全局 scope —— errors 与 logs 两条管道都会读 scope 上的 user，
    // 让 `count_unique(user)` 在 Sentry 侧能算出 DAU。
    sentry::configure_scope(|scope| {
        scope.set_user(Some(User {
            id: Some(device_id),
            ..Default::default()
        }));
    });
    log::info!("Sentry error reporting ENABLED");
    Some(guard)
}

/// 当前设备的匿名 ID（供「关于」页展示，用户报障时附上即可在 Sentry 按 user.id 定位）。
///
/// 文件不存在时会生成并落盘——即使上报未开启也返回稳定 ID，便于将来开启后对上。
pub fn current_device_id() -> String {
    device_id(Path::new(DEVICE_ID_FILE))
}

/// 把当前登录大区（如 `HN1` / `TJ100`）设为全局 tag，供 Sentry 侧按大区切片。
///
/// 大区是粗粒度服务器标识、非 PII。由 `game_state_monitor` 在 LCU 连接后调用；
/// 上报未开启时 `configure_scope` 是无客户端 no-op，无需额外判断。
pub fn set_region_tag(platform_id: &str) {
    sentry::configure_scope(|scope| {
        scope.set_tag("region", platform_id);
    });
}

/// 功能用量打点：向 Sentry Logs 发一条带 `feature` attribute 的结构化日志。
///
/// 在 Logs 面板按 `feature` 聚合即得各功能使用量 / 使用用户数（配合 user.id）。
/// 只传静态功能名，不携带任何用户数据；上报未开启时为 no-op。
pub fn track_feature(feature: &'static str) {
    sentry::logger_info!(feature = feature, kind = "usage", "feature_used");
}

/// 读取或首次生成匿名设备 ID。
///
/// 失败时返回随机 UUID 但**不写盘**——意味着这次会话被当作新设备，
/// 不会让无法持久化的环境（例如只读 CWD）让上报整体崩。
fn device_id(path: &Path) -> String {
    if let Ok(existing) = std::fs::read_to_string(path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let new_id = uuid::Uuid::new_v4().to_string();
    if let Err(e) = std::fs::write(path, &new_id) {
        log::warn!(
            "failed to persist device_id to {}: {} (will regenerate next launch)",
            path.display(),
            e
        );
    }
    new_id
}

/// `before_send` 钩子：在事件发送前移除 / 脱敏 PII。
///
/// 覆盖前端与后端的全部事件（前端事件经插件转发后也走这里）。
fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    // 主机名常包含用户真实姓名（如 "Zhang-MacBook"）。
    event.server_name = None;
    // 保留 `user.id`（init() 注入的匿名 UUID，用于 DAU 去重），清掉其余可能 PII 的字段。
    if let Some(user) = event.user.take() {
        event.user = Some(User {
            id: user.id,
            ..Default::default()
        });
    }

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

/// `before_send_log` 钩子：在结构化日志发送前脱敏正文 + 移除 hostname。
///
/// 全量转发（含 info）下，日志正文 `body` 是 PII 的主要载体——LCU 命令行里的
/// `*-auth-token`、`config.yaml` 转储、puuid / 召唤师名都在这里。对 `body` 跑
/// [`redact_pii`]（已覆盖 token / 名字 / UUID / 长 token）。
///
/// 此外 Sentry Logs 会自动附 `server.address` attribute（hostname），Windows 上
/// 常是用户自定义机名 / 昵称（"YXL"、"三火"、"saber"…），属 PII，必须删除。
/// errors 上的 `event.server_name` 由 [`scrub_event`] 负责，这里只管 logs 这条管道。
fn scrub_log(mut log: Log) -> Option<Log> {
    log.body = redact_pii(&log.body);
    log.attributes.remove("server.address");
    Some(log)
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
///
/// 除玩家标识外，还覆盖**凭据**：LCU 命令行里的 `--remoting-auth-token=` /
/// `--riotclient-auth-token=`（裸 `token` 借词边界即可匹配连字符形态），以及
/// `password` / `secret` / `access_token` 等。全量日志转发到 Sentry 时，这些一旦漏发
/// 等于把 LCU 会话令牌外传。
///
/// 注意：`Authorization` 头不在这里——它的值是 `Scheme token`（空格分隔），用本正则
/// 的"遇空格即停"值类只会洗掉 scheme（Bearer/Basic）漏掉 token，改由 [`AUTH_HEADER_RE`]
/// 整体脱敏。
static PII_PARAM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)("?\b(?:game_?name|tag_?line|summoner_?name|display_?name|riot_?id|puuid|account|name|auth_?token|access_?token|token|password|secret)"?\s*[:=]\s*"?)([^"&,\s}\])]+)"#,
    )
    .expect("valid pii-param regex")
});

/// `Authorization` 头专用：值是 `Scheme token`（如 `Bearer xxx` / `Basic <base64>`，
/// LCU 用 Basic）。值类**允许空格**，把 scheme + token 整体脱敏，避免只洗 scheme 漏 token。
/// 停在引号 / 换行（JSON 形态在闭合引号处停，行形态吃到行尾，均安全）。
static AUTH_HEADER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)("?\bauthorization"?\s*[:=]\s*"?)([^"\r\n]+)"#)
        .expect("valid auth-header regex")
});

/// 对单个字符串做 PII 脱敏。
///
/// 依次替换：按字段名（query / JSON / Debug）→ 标准 UUID → 超长 token。纯函数，便于单测。
///
/// 局限：无字段名上下文、直接拼进自由文本的名字（如 `format!("{} not found", name)`）
/// 无法识别——根本防线是默认关闭 + 不在日志里拼接玩家名。
pub fn redact_pii(input: &str) -> String {
    // 先洗 Authorization 头（值含空格，需整体脱敏）再走按字段名脱敏，避免后者把值截断。
    let step0 = AUTH_HEADER_RE.replace_all(input, "${1}<redacted>");
    let step1 = PII_PARAM_RE.replace_all(&step0, "${1}<redacted>");
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
    fn should_redact_lcu_auth_tokens() {
        // 真实日志里出现过的 LCU 命令行片段（连字符形态的 auth-token）
        let input = "LeagueClientUx.exe --remoting-auth-token=bZ8lkkL3wtVEMaXOaBGTxA \
                     --app-port=53970 --riotclient-auth-token=N5IO-YgihIVZDzqyiy7rrg";
        let out = redact_pii(input);
        assert!(
            !out.contains("bZ8lkkL3wtVEMaXOaBGTxA"),
            "remoting 令牌应被脱敏: {out}"
        );
        assert!(
            !out.contains("N5IO-YgihIVZDzqyiy7rrg"),
            "riotclient 令牌应被脱敏: {out}"
        );
        // 非敏感的端口号保留
        assert!(out.contains("app-port=53970"), "端口号应保留: {out}");
    }

    #[test]
    fn should_redact_authorization_header_scheme_and_token() {
        // Bearer 形态：scheme + token 用空格分隔，必须整体脱敏
        let bearer = redact_pii("Authorization: Bearer abc123def456ghi");
        assert!(
            !bearer.contains("abc123def456ghi"),
            "Bearer token 应被脱敏: {bearer}"
        );
        assert!(!bearer.contains("Bearer"), "scheme 也应被脱敏: {bearer}");

        // LCU 的 Basic <base64> 形态
        let basic = redact_pii(r#"{"authorization":"Basic cmlvdDpiWjhsa2tMM3d0", "x":1}"#);
        assert!(
            !basic.contains("cmlvdDpiWjhsa2tMM3d0"),
            "Basic 凭据应被脱敏: {basic}"
        );
        // JSON 里其他字段保留
        assert!(basic.contains("\"x\":1"), "非敏感字段应保留: {basic}");
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

    #[test]
    fn should_keep_user_id_but_strip_other_user_fields() {
        let event = Event {
            user: Some(User {
                id: Some("abc-device-uuid".to_string()),
                email: Some("real@example.com".to_string()),
                username: Some("realname".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let scrubbed = scrub_event(event).expect("event kept");
        let user = scrubbed.user.expect("user kept");
        assert_eq!(
            user.id.as_deref(),
            Some("abc-device-uuid"),
            "id 应保留用于 DAU 去重"
        );
        assert!(user.email.is_none(), "email 不应留下: {:?}", user.email);
        assert!(
            user.username.is_none(),
            "username 不应留下: {:?}",
            user.username
        );
    }

    // 没给 `should_strip_server_address_from_log_attributes` 写单测：sentry 0.42 的
    // `Log` struct 字段不稳定（severity_number / span_id 等版本间会变），构造 fixture
    // 反而比被测代码本身脆。`scrub_log` 的改动是 `attributes.remove("server.address")` 一行，
    // 验证通过部署后查 Sentry：30d 内应看到 `count_unique(server.address)` 停止增长。

    #[test]
    fn should_generate_and_persist_device_id() {
        let tmp = std::env::temp_dir().join(format!(
            "rank-analysis-device-id-test-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_file(&tmp);

        let first = device_id(&tmp);
        assert!(!first.is_empty(), "首次应生成非空 id");
        let on_disk = std::fs::read_to_string(&tmp).expect("写盘");
        assert_eq!(on_disk.trim(), first, "首次应落盘");

        let second = device_id(&tmp);
        assert_eq!(first, second, "再次调用应复用，而不是重新生成");

        let _ = std::fs::remove_file(&tmp);
    }
}
