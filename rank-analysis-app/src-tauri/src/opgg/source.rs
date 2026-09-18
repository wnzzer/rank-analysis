//! 英雄详情数据源 manifest：让 OP.GG 详情接口的地址与开关**可远程切换**。
//!
//! 详情数据由客户端直拉 OP.GG（量化理由见 spec「数据获取策略」），但任何硬编码在
//! 客户端里的外部 API 契约都是负债：便携版有相当一部分用户收不到更新，OP.GG 一旦改
//! 路径或封 UA，这批用户永久失效且无法靠发版挽救。故把 URL 模板与 kill switch 放进
//! 仓库里的 `data/builds-source.json`，经与 [`crate::cn_patch_notes`] 相同的双源
//! （jsDelivr → GitCode）分发——改一个 JSON 推一次，老版本也跟着恢复或停用。
//!
//! # 降级
//! 内存 → 磁盘（TTL 6h）→ 网络；网络失败沿用最后已知的远端决定（含 `disabled`），
//! 从未拿到过则用编译期默认值。**绝不因为 manifest 拉不到而让功能失效。**

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 本客户端认识的 manifest schema 版本；远端不一致即忽略（老客户端遇新 schema 安全降级）
pub const SOURCE_SCHEMA_VERSION: u32 = 1;
/// manifest 缓存有效期：6 小时（秒），与 `cn_patch_notes` 同档
pub const SOURCE_TTL_SECS: i64 = 6 * 60 * 60;

/// 分发源，按序尝试：jsDelivr CDN（国内可达）→ GitCode raw（仓库镜像）
const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/wnzzer/rank-analysis@main/data/builds-source.json",
    "https://gitcode.com/wnzzer/rank-analysis/raw/main/data/builds-source.json",
];

/// 编译期默认 URL 模板，必须与仓库 `data/builds-source.json` 一致（契约测试守护）。
///
/// `{position}` 填 OP.GG 分路命名（top/jungle/mid/adc/support，大乱斗为 none）——
/// 实测 LCU 命名 middle/bottom/utility 会被 OP.GG 以 422 拒绝。
const DEFAULT_URL_TEMPLATE: &str =
    "https://lol-api-champion.op.gg/api/global/champions/{mode}/{champion_id}/{position}?tier={tier}";

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// `data/builds-source.json` 的内容。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildsSource {
    pub schema_version: u32,
    /// `direct` = 直连 url_template；`mirror` = 走 mirror_base；`disabled` = 全局关闭本功能。
    ///
    /// 本版本客户端**不消费镜像格式**（镜像形态见 spec「CI 镜像留作后备」，尚未定型），
    /// `mirror` 时仍按 `url_template` 拉取。维护者切镜像时应同时把 `url_template`
    /// 指到同构源，或直接 `disabled`，以覆盖本版本及更老的客户端。
    pub strategy: String,
    /// 占位符：`{mode}` `{champion_id}` `{position}` `{tier}`
    pub url_template: String,
    pub mirror_base: Option<String>,
}

impl BuildsSource {
    /// 是否被远端 kill switch 关闭
    pub fn is_disabled(&self) -> bool {
        self.strategy == "disabled"
    }
}

/// 编译期默认 manifest：两源都不可达、或远端内容不合法时使用。
pub fn default_source() -> BuildsSource {
    BuildsSource {
        schema_version: SOURCE_SCHEMA_VERSION,
        strategy: "direct".into(),
        url_template: DEFAULT_URL_TEMPLATE.into(),
        mirror_base: None,
    }
}

/// 校验远端 manifest，不合法返回 `None`（由调用方回落默认值）。
///
/// 不合法：schema 版本不认识 / strategy 不在白名单 / `mirror` 却没给 `mirror_base` /
/// 模板里缺 `{champion_id}`（缺了等于所有英雄请求同一个地址，必是写错）。
pub fn validate(src: BuildsSource) -> Option<BuildsSource> {
    if src.schema_version != SOURCE_SCHEMA_VERSION {
        log::warn!("builds source schema {} unsupported", src.schema_version);
        return None;
    }
    let ok = match src.strategy.as_str() {
        "direct" | "disabled" => true,
        "mirror" => src
            .mirror_base
            .as_deref()
            .is_some_and(|b| !b.trim().is_empty()),
        _ => false,
    };
    if !ok || !src.url_template.contains("{champion_id}") {
        log::warn!("builds source rejected: {:?}", src);
        return None;
    }
    Some(src)
}

/// 解析并校验 manifest JSON；解析失败或校验不过返回 `None`。
pub fn parse(json: &str) -> Option<BuildsSource> {
    serde_json::from_str::<BuildsSource>(json)
        .ok()
        .and_then(validate)
}

/// 填充 URL 模板的四个占位符；模板里的其他 `{xxx}` 原样保留（不 panic、不吞掉）。
pub fn fill_template(
    template: &str,
    mode: &str,
    champion_id: i32,
    position: &str,
    tier: &str,
) -> String {
    template
        .replace("{mode}", mode)
        .replace("{champion_id}", &champion_id.to_string())
        .replace("{position}", position)
        .replace("{tier}", tier)
}

/// 本地缓存快照：`checked_at` 驱动 TTL
#[derive(Serialize, Deserialize, Debug, Clone)]
struct SourceSnapshot {
    checked_at: i64,
    source: BuildsSource,
}

fn default_path() -> PathBuf {
    crate::paths::cache_file("builds_source_cache.json")
}

fn load_from_path(path: &Path) -> Option<SourceSnapshot> {
    let content = std::fs::read_to_string(path).ok()?;
    let snap: SourceSnapshot = serde_json::from_str(&content).ok()?;
    // 磁盘里的旧快照同样要过校验：本地文件被改坏 / 升级后 schema 变了都视为无
    validate(snap.source.clone()).map(|_| snap)
}

fn save_to_path(snapshot: &SourceSnapshot, path: &Path) {
    if let Ok(json) = serde_json::to_string(snapshot) {
        if let Err(e) = std::fs::write(path, json) {
            log::warn!("builds source cache write {}: {}", path.display(), e);
        }
    }
}

/// 按序尝试两个分发源，返回第一个合法的 manifest。
async fn fetch_remote() -> Option<BuildsSource> {
    let client = match reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("builds source client build failed: {}", e);
            return None;
        }
    };
    for url in SOURCES {
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => {
                    if let Some(src) = parse(&text) {
                        log::info!("builds source: {} (from {})", src.strategy, url);
                        return Some(src);
                    }
                    // 2026-09-15 实测 GitCode 的 /raw/ 对任意路径都回 200 + HTML 页面，
                    // 不打这行的话「源失效」在日志里完全不可见
                    let head: String = text.chars().take(60).collect();
                    log::warn!("builds source {} 返回的不是合法 manifest: {:?}", url, head);
                }
                Err(e) => log::warn!("builds source read {} failed: {}", url, e),
            },
            Ok(resp) => log::warn!("builds source {} HTTP {}", url, resp.status()),
            Err(e) => log::warn!("builds source {} failed: {}", url, e),
        }
    }
    None
}

/// 三级缓存编排的可注入实现（供单测注入假磁盘 / 假拉取 / 当前时间）。
///
/// 拉取失败时沿用最后已知的远端决定（磁盘里过期的快照），且**只放内存、不刷新
/// 磁盘的 checked_at**——避免把一次网络故障钉死 6 小时。
async fn resolve_impl<F, Fut>(
    slot: &tokio::sync::Mutex<Option<Arc<SourceSnapshot>>>,
    now: i64,
    disk_load: impl Fn() -> Option<SourceSnapshot>,
    disk_save: impl Fn(&SourceSnapshot),
    fetch: F,
) -> Arc<BuildsSource>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Option<BuildsSource>>,
{
    let mut guard = slot.lock().await;
    if let Some(snap) = guard.as_ref() {
        if now - snap.checked_at < SOURCE_TTL_SECS {
            return Arc::new(snap.source.clone());
        }
    }
    let disk = disk_load();
    if let Some(d) = disk.as_ref() {
        if now - d.checked_at < SOURCE_TTL_SECS {
            *guard = Some(Arc::new(d.clone()));
            return Arc::new(d.source.clone());
        }
    }

    let source = match fetch().await {
        Some(src) => {
            disk_save(&SourceSnapshot {
                checked_at: now,
                source: src.clone(),
            });
            src
        }
        None => disk.map(|d| d.source).unwrap_or_else(default_source),
    };
    *guard = Some(Arc::new(SourceSnapshot {
        checked_at: now,
        source: source.clone(),
    }));
    Arc::new(source)
}

/// 进程内缓存 + 单飞锁：并发的首次请求只拉一次 manifest
static SNAPSHOT: tokio::sync::Mutex<Option<Arc<SourceSnapshot>>> =
    tokio::sync::Mutex::const_new(None);

/// 取当前生效的数据源 manifest。
pub async fn get_or_fetch() -> Arc<BuildsSource> {
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

    fn source(schema: u32, strategy: &str, mirror_base: Option<&str>) -> BuildsSource {
        BuildsSource {
            schema_version: schema,
            strategy: strategy.into(),
            url_template: DEFAULT_URL_TEMPLATE.into(),
            mirror_base: mirror_base.map(String::from),
        }
    }

    #[test]
    fn fill_template_should_replace_all_four_placeholders() {
        let url = fill_template(DEFAULT_URL_TEMPLATE, "ranked", 157, "mid", "gold_plus");
        assert_eq!(
            url,
            "https://lol-api-champion.op.gg/api/global/champions/ranked/157/mid?tier=gold_plus"
        );
    }

    #[test]
    fn fill_template_should_keep_unknown_placeholders_verbatim() {
        let url = fill_template("x/{mode}/{patch}/{champion_id}", "aram", 1, "none", "all");
        assert_eq!(url, "x/aram/{patch}/1");
    }

    #[test]
    fn validate_should_accept_direct_and_disabled() {
        assert!(validate(source(1, "direct", None)).is_some());
        assert!(validate(source(1, "disabled", None)).is_some());
        assert!(validate(source(1, "mirror", Some("https://m.example/builds"))).is_some());
    }

    #[test]
    fn validate_should_reject_schema_mismatch() {
        // 老客户端遇到新 schema：忽略远端，由调用方回落编译期默认值
        assert!(validate(source(2, "direct", None)).is_none());
    }

    #[test]
    fn validate_should_reject_mirror_without_base() {
        assert!(validate(source(1, "mirror", None)).is_none());
        assert!(validate(source(1, "mirror", Some("  "))).is_none());
    }

    #[test]
    fn validate_should_reject_unknown_strategy_or_template_without_champion() {
        assert!(validate(source(1, "cdn", None)).is_none());
        let mut s = source(1, "direct", None);
        s.url_template = "https://example.com/{mode}".into();
        assert!(validate(s).is_none());
    }

    #[test]
    fn parse_should_return_none_for_garbage() {
        assert!(parse("not json").is_none());
        assert!(parse(r#"{"schemaVersion":1}"#).is_none());
    }

    /// 契约测试：仓库内 manifest 必须能被本客户端解析，且与编译期默认值一致——
    /// 两者一旦漂移，「两源都拉不到」时的兜底行为就和线上配置不是一回事了。
    #[test]
    fn repo_manifest_should_equal_compiled_default() {
        let json = include_str!("../../../../data/builds-source.json");
        let parsed = parse(json).expect("data/builds-source.json 应符合 schema v1");
        assert_eq!(parsed, default_source());
    }

    #[test]
    fn is_disabled_should_only_match_disabled_strategy() {
        assert!(source(1, "disabled", None).is_disabled());
        assert!(!source(1, "direct", None).is_disabled());
    }

    // ---- resolve_impl（三级缓存编排）----

    const NOW: i64 = 2_000_000_000;

    fn slot() -> tokio::sync::Mutex<Option<Arc<SourceSnapshot>>> {
        tokio::sync::Mutex::const_new(None)
    }

    fn snapshot_at(checked_at: i64, strategy: &str) -> SourceSnapshot {
        SourceSnapshot {
            checked_at,
            source: source(1, strategy, None),
        }
    }

    #[tokio::test]
    async fn resolve_should_use_fresh_memory_without_fetching() {
        let slot = slot();
        *slot.lock().await = Some(Arc::new(snapshot_at(NOW - 10, "disabled")));
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
        assert!(got.is_disabled());
    }

    #[tokio::test]
    async fn resolve_should_promote_fresh_disk_without_fetching() {
        let slot = slot();
        let fetched = AtomicBool::new(false);

        let got = resolve_impl(
            &slot,
            NOW,
            || Some(snapshot_at(NOW - 10, "disabled")),
            |_| {},
            || {
                fetched.store(true, Ordering::SeqCst);
                async { None }
            },
        )
        .await;

        assert!(!fetched.load(Ordering::SeqCst));
        assert!(got.is_disabled());
        assert!(slot.lock().await.is_some(), "磁盘命中应回填内存");
    }

    #[tokio::test]
    async fn resolve_should_fetch_and_save_when_caches_expired() {
        let slot = slot();
        let saved = AtomicBool::new(false);

        let got = resolve_impl(
            &slot,
            NOW,
            || Some(snapshot_at(NOW - SOURCE_TTL_SECS, "direct")),
            |s| {
                assert_eq!(s.checked_at, NOW);
                saved.store(true, Ordering::SeqCst);
            },
            || async { Some(source(1, "disabled", None)) },
        )
        .await;

        assert!(got.is_disabled(), "应采用远端的新决定");
        assert!(saved.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn resolve_should_keep_last_known_disk_source_when_fetch_fails() {
        // 远端曾下发 kill switch，这次两源都不可达：沿用最后已知决定，而不是回到默认直连
        let got = resolve_impl(
            &slot(),
            NOW,
            || Some(snapshot_at(NOW - SOURCE_TTL_SECS - 1, "disabled")),
            |_| panic!("拉取失败不应落盘"),
            || async { None },
        )
        .await;

        assert!(got.is_disabled());
    }

    #[tokio::test]
    async fn resolve_should_fall_back_to_default_when_nothing_available() {
        let got = resolve_impl(&slot(), NOW, || None, |_| {}, || async { None }).await;

        assert_eq!(*got, default_source(), "两源都拉不到也绝不能让功能失效");
    }
}
