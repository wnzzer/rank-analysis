//! AI 模型路由 manifest：让各 AI 场景用哪个模型**可远程切换**。
//!
//! 模型名原先硬编码在前端：换模型必须发版，而便携版有相当一部分用户收不到更新，
//! 某个模型下线 / 变慢 / 涨价时这批用户只能一直用旧的。故把「场景 → 模型」映射放进
//! 仓库里的 `data/ai-config.json`，经与 [`crate::opgg::source`] 相同的双源
//! （jsDelivr → GitCode）分发——改一个 JSON 推一次，老版本也跟着切。
//!
//! 场景名（`matchAttribution` / `matchCritique` / `inGame` …）由前端定义并消费，
//! Rust 只负责分发与校验，不认识具体场景：前端新增场景不需要改这里。
//!
//! # 降级
//! 内存 → 磁盘（TTL 1h）→ 网络；网络失败沿用最后已知的远端配置，
//! 从未拿到过则用编译期默认值。**绝不因为 manifest 拉不到而让 AI 功能失效。**

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 本客户端认识的 manifest schema 版本；远端不一致即忽略（老客户端遇新 schema 安全降级）
pub const CONFIG_SCHEMA_VERSION: u32 = 1;
/// manifest 缓存有效期：1 小时（秒）。比 builds-source 的 6h 短——模型出问题时要能快速切走
pub const CONFIG_TTL_SECS: i64 = 60 * 60;
/// 模型名长度上限：DashScope 现有模型名最长约 30 字符，留足余量
const MAX_MODEL_NAME_LEN: usize = 64;

/// 分发源，按序尝试：jsDelivr CDN（国内可达）→ GitCode（v5 API 取原始文件，同 `opgg::source`）
const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/wnzzer/rank-analysis@main/data/ai-config.json",
    "https://api.gitcode.com/api/v5/repos/wnzzer/rank-analysis/raw/data%2Fai-config.json?ref=main",
];

/// 编译期默认模型：两源都不可达、或远端内容不合法时所有场景都用它（契约测试守护与仓库文件一致）。
///
/// deepseek-v4.1-flash-1017：tests/bench-ai-quality.ts + tests/ai-features.eval.ts 实测
/// Stage1 ~16s（qwen-flash ~13s），出字速度最快；四类功能的数字接地与归因理解均优于
/// qwen-flash / qwen3.8-flash。注意它默认开思考，请求体必须带 `enable_thinking: false`
/// （见 `command::ai::build_request_body`）。
pub const DEFAULT_MODEL: &str = "deepseek-v4.1-flash-1017";

/// `data/ai-config.json` 的内容。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub schema_version: u32,
    /// 场景名 → 模型名；`default` 为未单独配置的场景兜底
    pub models: BTreeMap<String, String>,
}

/// 编译期默认 manifest
pub fn default_config() -> AiConfig {
    let mut models = BTreeMap::new();
    models.insert("default".to_string(), DEFAULT_MODEL.to_string());
    AiConfig {
        schema_version: CONFIG_SCHEMA_VERSION,
        models,
    }
}

/// 模型名是否像个模型名：非空、不超长、只含 DashScope 模型名用到的字符
/// （第三方模型形如 `ZHIPU/GLM-5.3-Flash`，故放行 `/`）。
fn is_valid_model_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_MODEL_NAME_LEN
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
}

/// 校验远端 manifest，不合法返回 `None`（由调用方回落默认值）。
///
/// 不合法：schema 版本不认识 / 缺 `default` / 任一模型名非法（写错一个就整份拒收，
/// 避免半份配置让部分场景悄悄走错模型）。
pub fn validate(cfg: AiConfig) -> Option<AiConfig> {
    if cfg.schema_version != CONFIG_SCHEMA_VERSION {
        log::warn!("ai config schema {} unsupported", cfg.schema_version);
        return None;
    }
    let ok = cfg.models.contains_key("default")
        && cfg
            .models
            .iter()
            .all(|(scene, model)| !scene.is_empty() && is_valid_model_name(model));
    if !ok {
        log::warn!("ai config rejected: {:?}", cfg);
        return None;
    }
    Some(cfg)
}

/// 解析并校验 manifest JSON；解析失败或校验不过返回 `None`。
pub fn parse(json: &str) -> Option<AiConfig> {
    serde_json::from_str::<AiConfig>(json)
        .ok()
        .and_then(validate)
}

/// 本地缓存快照：`checked_at` 驱动 TTL
#[derive(Serialize, Deserialize, Debug, Clone)]
struct ConfigSnapshot {
    checked_at: i64,
    config: AiConfig,
}

fn default_path() -> PathBuf {
    crate::paths::cache_file("ai_config_cache.json")
}

fn load_from_path(path: &Path) -> Option<ConfigSnapshot> {
    let content = std::fs::read_to_string(path).ok()?;
    let snap: ConfigSnapshot = serde_json::from_str(&content).ok()?;
    // 磁盘里的旧快照同样要过校验：本地文件被改坏 / 升级后 schema 变了都视为无
    validate(snap.config.clone()).map(|_| snap)
}

fn save_to_path(snapshot: &ConfigSnapshot, path: &Path) {
    if let Ok(json) = serde_json::to_string(snapshot) {
        if let Err(e) = std::fs::write(path, json) {
            log::warn!("ai config cache write {}: {}", path.display(), e);
        }
    }
}

/// 按序尝试两个分发源，返回第一个合法的 manifest。
async fn fetch_remote() -> Option<AiConfig> {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("ai config client build failed: {}", e);
            return None;
        }
    };
    for url in SOURCES {
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => {
                    if let Some(cfg) = parse(&text) {
                        log::info!("ai config: {:?} (from {})", cfg.models, url);
                        return Some(cfg);
                    }
                    // GitCode 对任意路径可能回 200 + HTML（见 opgg::source），不打日志则源失效不可见
                    let head: String = text.chars().take(60).collect();
                    log::warn!("ai config {} 返回的不是合法 manifest: {:?}", url, head);
                }
                Err(e) => log::warn!("ai config read {} failed: {}", url, e),
            },
            Ok(resp) => log::warn!("ai config {} HTTP {}", url, resp.status()),
            Err(e) => log::warn!("ai config {} failed: {}", url, e),
        }
    }
    None
}

/// 三级缓存编排的可注入实现（供单测注入假磁盘 / 假拉取 / 当前时间）。
///
/// 拉取失败时沿用最后已知的远端配置（磁盘里过期的快照），且**只放内存、不刷新
/// 磁盘的 checked_at**——避免把一次网络故障钉死一个 TTL。
async fn resolve_impl<F, Fut>(
    slot: &tokio::sync::Mutex<Option<Arc<ConfigSnapshot>>>,
    now: i64,
    disk_load: impl Fn() -> Option<ConfigSnapshot>,
    disk_save: impl Fn(&ConfigSnapshot),
    fetch: F,
) -> Arc<AiConfig>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Option<AiConfig>>,
{
    let mut guard = slot.lock().await;
    if let Some(snap) = guard.as_ref() {
        if now - snap.checked_at < CONFIG_TTL_SECS {
            return Arc::new(snap.config.clone());
        }
    }
    let disk = disk_load();
    if let Some(d) = disk.as_ref() {
        if now - d.checked_at < CONFIG_TTL_SECS {
            *guard = Some(Arc::new(d.clone()));
            return Arc::new(d.config.clone());
        }
    }

    let config = match fetch().await {
        Some(cfg) => {
            disk_save(&ConfigSnapshot {
                checked_at: now,
                config: cfg.clone(),
            });
            cfg
        }
        None => disk.map(|d| d.config).unwrap_or_else(default_config),
    };
    *guard = Some(Arc::new(ConfigSnapshot {
        checked_at: now,
        config: config.clone(),
    }));
    Arc::new(config)
}

/// 进程内缓存 + 单飞锁：并发的首次请求只拉一次 manifest
static SNAPSHOT: tokio::sync::Mutex<Option<Arc<ConfigSnapshot>>> =
    tokio::sync::Mutex::const_new(None);

/// 取当前生效的 AI 模型配置。
pub async fn get_or_fetch() -> Arc<AiConfig> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    resolve_impl(
        &SNAPSHOT,
        now,
        || load_from_path(&default_path()),
        |s| save_to_path(s, &default_path()),
        fetch_remote,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn config(schema: u32, pairs: &[(&str, &str)]) -> AiConfig {
        AiConfig {
            schema_version: schema,
            models: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    #[test]
    fn validate_should_accept_default_plus_scene_overrides() {
        let cfg = config(
            1,
            &[
                ("default", "deepseek-v4.1-flash-1017"),
                ("tagSuggest", "qwen-plus"),
                ("inGame", "ZHIPU/GLM-5.3-Flash"),
            ],
        );
        assert!(validate(cfg).is_some());
    }

    #[test]
    fn validate_should_reject_schema_mismatch() {
        assert!(validate(config(2, &[("default", "qwen-flash")])).is_none());
    }

    #[test]
    fn validate_should_reject_missing_default() {
        assert!(validate(config(1, &[("inGame", "qwen-flash")])).is_none());
    }

    #[test]
    fn validate_should_reject_whole_config_when_any_model_name_invalid() {
        // 写错一个就整份拒收，不让其余场景带着半份配置上线
        assert!(validate(config(1, &[("default", "qwen-flash"), ("inGame", "")])).is_none());
        assert!(validate(config(1, &[("default", "qwen flash")])).is_none());
        assert!(validate(config(1, &[("default", &"x".repeat(65))])).is_none());
    }

    #[test]
    fn parse_should_return_none_for_garbage() {
        assert!(parse("not json").is_none());
        assert!(parse(r#"{"schemaVersion":1}"#).is_none());
        assert!(parse("<html>gitcode</html>").is_none());
    }

    /// 契约测试：仓库内 manifest 必须能被本客户端解析，且 `default` 与编译期默认值一致——
    /// 两者一旦漂移，「两源都拉不到」时的兜底模型就和线上配置不是一回事了。
    #[test]
    fn repo_manifest_default_should_equal_compiled_default() {
        let json = include_str!("../../../data/ai-config.json");
        let parsed = parse(json).expect("data/ai-config.json 应符合 schema v1");
        assert_eq!(
            parsed.models.get("default").map(String::as_str),
            Some(DEFAULT_MODEL)
        );
    }

    // ---- resolve_impl（三级缓存编排）----

    const NOW: i64 = 2_000_000_000;

    fn slot() -> tokio::sync::Mutex<Option<Arc<ConfigSnapshot>>> {
        tokio::sync::Mutex::const_new(None)
    }

    fn snapshot_at(checked_at: i64, model: &str) -> ConfigSnapshot {
        ConfigSnapshot {
            checked_at,
            config: config(1, &[("default", model)]),
        }
    }

    fn default_of(cfg: &AiConfig) -> &str {
        cfg.models.get("default").map(String::as_str).unwrap_or("")
    }

    #[tokio::test]
    async fn resolve_should_use_fresh_memory_without_fetching() {
        let slot = slot();
        *slot.lock().await = Some(Arc::new(snapshot_at(NOW - 10, "qwen3.8-flash")));
        let fetched = AtomicBool::new(false);

        let got = resolve_impl(
            &slot,
            NOW,
            || None,
            |_| {},
            || {
                fetched.store(true, Ordering::SeqCst);
                async { None }
            },
        )
        .await;

        assert!(!fetched.load(Ordering::SeqCst));
        assert_eq!(default_of(&got), "qwen3.8-flash");
    }

    #[tokio::test]
    async fn resolve_should_promote_fresh_disk_without_fetching() {
        let slot = slot();
        let fetched = AtomicBool::new(false);

        let got = resolve_impl(
            &slot,
            NOW,
            || Some(snapshot_at(NOW - 10, "qwen3.8-flash")),
            |_| {},
            || {
                fetched.store(true, Ordering::SeqCst);
                async { None }
            },
        )
        .await;

        assert!(!fetched.load(Ordering::SeqCst));
        assert_eq!(default_of(&got), "qwen3.8-flash");
        assert!(slot.lock().await.is_some(), "磁盘命中应回填内存");
    }

    #[tokio::test]
    async fn resolve_should_fetch_and_save_when_caches_expired() {
        let saved = AtomicBool::new(false);

        let got = resolve_impl(
            &slot(),
            NOW,
            || Some(snapshot_at(NOW - CONFIG_TTL_SECS, "qwen-flash")),
            |s| {
                assert_eq!(s.checked_at, NOW);
                saved.store(true, Ordering::SeqCst);
            },
            || async { Some(config(1, &[("default", "qwen3.8-flash")])) },
        )
        .await;

        assert_eq!(default_of(&got), "qwen3.8-flash", "应采用远端的新配置");
        assert!(saved.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn resolve_should_keep_last_known_disk_config_when_fetch_fails() {
        let got = resolve_impl(
            &slot(),
            NOW,
            || Some(snapshot_at(NOW - CONFIG_TTL_SECS - 1, "qwen3.8-flash")),
            |_| panic!("拉取失败不应落盘"),
            || async { None },
        )
        .await;

        assert_eq!(default_of(&got), "qwen3.8-flash");
    }

    #[tokio::test]
    async fn resolve_should_fall_back_to_default_when_nothing_available() {
        let got = resolve_impl(&slot(), NOW, || None, |_| {}, || async { None }).await;
        assert_eq!(*got, default_config());
    }
}
