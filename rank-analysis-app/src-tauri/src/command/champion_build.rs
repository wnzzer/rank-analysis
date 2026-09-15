//! # 英雄推荐构筑命令
//!
//! 选人期推荐栏与 `apply_runes` 自动化共用的数据入口：解析请求目标 → 查缓存 → 拉 OP.GG。
//!
//! ## 降级链
//!
//! 内存（当前 patch）→ 磁盘（当前 patch 目录）→ HTTP（写盘 + 回填内存 + 清旧 patch）→
//! 其他 patch 的旧条目（标 `stale=true`）→ `None`。数据缺失是常态降级路径，前端拿到
//! `None` 时整条推荐栏不渲染；manifest 下发 `disabled` 时直接 `None`、一个请求都不发。
//!
//! 「当前 patch」取自 OP.GG 列表快照（启动即预热，与详情同一个 `meta.version`）；
//! 列表也没有时跳过磁盘直接拉，拉不到再按 stale 兜底。

use crate::opgg::detail::{self, BuildTarget, ChampionBuild};
use crate::opgg::source::{self, BuildsSource};
use crate::state::AppState;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

/// 内存缓存键：同一目标的不同 patch 共用一个键，旧 patch 条目兼作 stale 兜底
fn cache_key(target: &BuildTarget, champion_id: i32) -> String {
    format!(
        "{}:{}:{}:{}",
        target.mode, target.tier, champion_id, target.position
    )
}

/// 降级链编排的可注入实现（供单测注入假拉取、临时缓存根目录）。
///
/// # 参数
/// - `mem`: 内存缓存（`AppState::build_cache`）
/// - `root`: 磁盘缓存根目录（生产为 [`detail::builds_root`]）
/// - `source`: 当前生效的数据源 manifest
/// - `target` / `champion_id`: 请求目标
/// - `current_patch`: 当前 patch（取自列表快照），未知为 None
/// - `fetch`: 以填好的 URL 拉取并解析（生产为 [`detail::fetch_build`]）
pub(crate) async fn ensure_build_impl<F, Fut>(
    mem: &moka::future::Cache<String, Arc<ChampionBuild>>,
    root: &Path,
    source: &BuildsSource,
    target: &BuildTarget,
    champion_id: i32,
    current_patch: Option<&str>,
    fetch: F,
) -> Option<ChampionBuild>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<ChampionBuild, String>>,
{
    if source.is_disabled() {
        return None;
    }
    let key = cache_key(target, champion_id);

    // 1. 内存：patch 未知时信任本进程内拉到的数据
    if let Some(hit) = mem.get(&key).await {
        if current_patch.is_none_or(|p| hit.patch == p) {
            return Some((*hit).clone());
        }
    }

    // 2. 磁盘：只看当前 patch 目录
    if let Some(patch) = current_patch.filter(|p| detail::is_safe_patch(p)) {
        let path = detail::build_file_path(root, patch, target, champion_id);
        if let Some(disk) = detail::load_file(&path, target) {
            mem.insert(key, Arc::new(disk.clone())).await;
            return Some(disk);
        }
    }

    // 3. HTTP
    let opgg_position = detail::to_opgg_position(&target.position)?;
    let url = source::fill_template(
        &source.url_template,
        &target.mode,
        champion_id,
        opgg_position,
        &target.tier,
    );
    match fetch(url).await {
        Ok(build) => {
            if detail::is_safe_patch(&build.patch) {
                let path = detail::build_file_path(root, &build.patch, target, champion_id);
                match detail::save_file(&path, &build) {
                    Ok(()) => detail::cleanup_other_patches(root, &build.patch),
                    Err(e) => log::warn!("OP.GG detail cache save failed: {}", e),
                }
            } else {
                log::warn!(
                    "OP.GG detail patch {:?} unsafe as dir, not cached",
                    build.patch
                );
            }
            mem.insert(key, Arc::new(build.clone())).await;
            Some(build)
        }
        Err(e) => {
            // 4. 旧 patch 兜底（内存优先，其次磁盘），标 stale 让前端提示版本
            log::warn!(
                "OP.GG detail fetch {} failed, falling back to stale cache: {}",
                key,
                e
            );
            let stale = match mem.get(&key).await {
                Some(hit) => Some((*hit).clone()),
                None => detail::find_stale(root, target, champion_id),
            };
            stale.map(|mut b| {
                b.stale = true;
                b
            })
        }
    }
}

/// 解析某英雄的请求目标（模式 / 分路 / 段位），**不拉 OP.GG 详情**。
///
/// 单独拆出来给 `apply_runes` 用：匹配「我的符文方案」只需要分路，方案存在时不该为了
/// 算分路去拉一次详情——OP.GG 挂了方案也得照样能写。
///
/// # 参数
/// - `champion_id`: 英雄 ID（≤0 直接 None）
/// - `game_mode`: LCU `gameMode`，决定 ranked / aram / 不推荐
/// - `position`: 我的 `assignedPosition`，无分配为 None / ""（ranked 时退回列表快照里的主分路）
pub async fn resolve_build_target(
    state: &AppState,
    champion_id: i32,
    game_mode: &str,
    position: Option<&str>,
) -> Option<BuildTarget> {
    if champion_id <= 0 {
        return None;
    }
    let tier_cfg = crate::config::get_config("settings.opgg.tier")
        .await
        .ok()
        .and_then(|v| crate::config::extract_string(&v));
    let tier = crate::opgg::api::sanitize_tier(tier_cfg.as_deref());

    // 无分配分路时的兜底：OP.GG 列表快照里该英雄的主分路
    let main_position = state
        .opgg_cache
        .get("ranked")
        .await
        .and_then(|snap| crate::command::opgg::select_meta(&snap, champion_id, None))
        .map(|m| m.position);
    detail::resolve_target(game_mode, position, main_position.as_deref(), tier)
}

/// 取某英雄的推荐构筑（命令层与 `apply_runes` 自动化共用）。
///
/// 参数语义见 [`resolve_build_target`]。无数据（模式不支持、源被关闭、拉取失败且无缓存）
/// 一律 `None`，不报错。
pub async fn resolve_champion_build(
    state: &AppState,
    champion_id: i32,
    game_mode: &str,
    position: Option<&str>,
) -> Option<ChampionBuild> {
    let target = resolve_build_target(state, champion_id, game_mode, position).await?;
    fetch_build_for_target(state, champion_id, &target).await
}

/// 按已解析的目标取构筑：内存 → 磁盘 → HTTP → stale，见模块文档「降级链」。
pub async fn fetch_build_for_target(
    state: &AppState,
    champion_id: i32,
    target: &BuildTarget,
) -> Option<ChampionBuild> {
    let source = source::get_or_fetch().await;
    let current_patch = state
        .opgg_cache
        .get(&target.mode)
        .await
        .map(|snap| snap.patch.clone());

    let fetch_target = target.clone();
    ensure_build_impl(
        &state.build_cache,
        &detail::builds_root(),
        &source,
        target,
        champion_id,
        current_patch.as_deref(),
        |url| async move { detail::fetch_build(&url, &fetch_target, champion_id).await },
    )
    .await
}

/// 查询某英雄的推荐构筑（符文 / 出装 / 加点 / 召唤师技能）。
///
/// 参数语义见 [`resolve_champion_build`]；无数据是 `Ok(None)`，不是错误。
#[tauri::command]
pub async fn get_champion_build(
    champion_id: i32,
    game_mode: String,
    position: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<ChampionBuild>, String> {
    Ok(resolve_champion_build(&state, champion_id, &game_mode, position.as_deref()).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opgg::detail::{
        build_file_path, save_file, BuildTarget, ChampionBuild, BUILD_SCHEMA_VERSION,
    };
    use crate::opgg::source::default_source;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    fn target() -> BuildTarget {
        BuildTarget {
            mode: "ranked".into(),
            position: "middle".into(),
            tier: "emerald_plus".into(),
        }
    }

    fn build(patch: &str) -> ChampionBuild {
        ChampionBuild {
            schema_version: BUILD_SCHEMA_VERSION,
            champion_id: 157,
            position: "middle".into(),
            mode: "ranked".into(),
            tier: "emerald_plus".into(),
            patch: patch.into(),
            fetched_at: 1,
            play: 1000,
            win_rate: 0.5,
            runes: vec![],
            spells: vec![],
            starter_items: vec![],
            boots: vec![],
            core_items: vec![],
            last_items: vec![],
            skills: vec![],
            stale: false,
        }
    }

    fn mem() -> moka::future::Cache<String, Arc<ChampionBuild>> {
        moka::future::Cache::builder().max_capacity(120).build()
    }

    fn temp_root(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("ra-build-cmd-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    /// 断言不会被调用的拉取
    fn no_fetch(
        flag: &AtomicBool,
    ) -> impl FnOnce(String) -> std::future::Ready<Result<ChampionBuild, String>> + '_ {
        move |_url| {
            flag.store(true, Ordering::SeqCst);
            std::future::ready(Err("should not fetch".into()))
        }
    }

    #[tokio::test]
    async fn should_return_none_without_fetching_when_source_disabled() {
        let mut src = default_source();
        src.strategy = "disabled".into();
        let fetched = AtomicBool::new(false);

        let got = ensure_build_impl(
            &mem(),
            &temp_root("disabled"),
            &src,
            &target(),
            157,
            Some("16.18"),
            no_fetch(&fetched),
        )
        .await;

        assert!(got.is_none(), "kill switch 必须让功能整体消失");
        assert!(!fetched.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn should_fill_url_with_opgg_position_naming() {
        let root = temp_root("url");
        let seen = Mutex::new(String::new());

        let _ = ensure_build_impl(
            &mem(),
            &root,
            &default_source(),
            &target(),
            157,
            None,
            |url| {
                *seen.lock().unwrap() = url;
                std::future::ready(Ok(build("16.18")))
            },
        )
        .await;

        assert_eq!(
            *seen.lock().unwrap(),
            "https://lol-api-champion.op.gg/api/global/champions/ranked/157/mid?tier=emerald_plus",
            "LCU 的 middle 必须转成 OP.GG 的 mid，否则 422"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn should_return_memory_hit_for_current_patch_without_fetching() {
        let cache = mem();
        cache
            .insert(cache_key(&target(), 157), Arc::new(build("16.18")))
            .await;
        let fetched = AtomicBool::new(false);

        let got = ensure_build_impl(
            &cache,
            &temp_root("mem"),
            &default_source(),
            &target(),
            157,
            Some("16.18"),
            no_fetch(&fetched),
        )
        .await
        .unwrap();

        assert!(!fetched.load(Ordering::SeqCst));
        assert_eq!(got.patch, "16.18");
        assert!(!got.stale);
    }

    #[tokio::test]
    async fn should_refetch_when_memory_entry_is_from_old_patch() {
        let cache = mem();
        cache
            .insert(cache_key(&target(), 157), Arc::new(build("16.17")))
            .await;
        let root = temp_root("mem-old");

        let got = ensure_build_impl(
            &cache,
            &root,
            &default_source(),
            &target(),
            157,
            Some("16.18"),
            |_| std::future::ready(Ok(build("16.18"))),
        )
        .await
        .unwrap();

        assert_eq!(got.patch, "16.18");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn should_promote_disk_hit_without_fetching() {
        let root = temp_root("disk");
        save_file(
            &build_file_path(&root, "16.18", &target(), 157),
            &build("16.18"),
        )
        .unwrap();
        let cache = mem();
        let fetched = AtomicBool::new(false);

        let got = ensure_build_impl(
            &cache,
            &root,
            &default_source(),
            &target(),
            157,
            Some("16.18"),
            no_fetch(&fetched),
        )
        .await
        .unwrap();

        assert!(!fetched.load(Ordering::SeqCst));
        assert_eq!(got.patch, "16.18");
        assert!(
            cache.get(&cache_key(&target(), 157)).await.is_some(),
            "磁盘命中应回填内存"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn should_save_fetched_build_and_clean_old_patch_dirs() {
        let root = temp_root("save");
        save_file(
            &build_file_path(&root, "16.17", &target(), 86),
            &build("16.17"),
        )
        .unwrap();
        let cache = mem();

        let got = ensure_build_impl(
            &cache,
            &root,
            &default_source(),
            &target(),
            157,
            Some("16.18"),
            |_| std::future::ready(Ok(build("16.18"))),
        )
        .await
        .unwrap();

        assert!(!got.stale);
        assert!(build_file_path(&root, "16.18", &target(), 157).is_file());
        assert!(!root.join("16.17").exists(), "旧 patch 目录应被清理");
        assert!(cache.get(&cache_key(&target(), 157)).await.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn should_fall_back_to_stale_memory_when_fetch_fails() {
        let cache = mem();
        cache
            .insert(cache_key(&target(), 157), Arc::new(build("16.17")))
            .await;

        let got = ensure_build_impl(
            &cache,
            &temp_root("stale-mem"),
            &default_source(),
            &target(),
            157,
            Some("16.18"),
            |_| std::future::ready(Err("network down".into())),
        )
        .await
        .unwrap();

        assert!(got.stale, "旧 patch 数据必须标 stale，前端据此提示版本");
        assert_eq!(got.patch, "16.17");
    }

    #[tokio::test]
    async fn should_fall_back_to_stale_disk_when_fetch_fails() {
        let root = temp_root("stale-disk");
        save_file(
            &build_file_path(&root, "16.17", &target(), 157),
            &build("16.17"),
        )
        .unwrap();

        let got = ensure_build_impl(
            &mem(),
            &root,
            &default_source(),
            &target(),
            157,
            Some("16.18"),
            |_| std::future::ready(Err("network down".into())),
        )
        .await
        .unwrap();

        assert!(got.stale);
        assert_eq!(got.patch, "16.17");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn should_return_none_when_fetch_fails_without_any_cache() {
        let got = ensure_build_impl(
            &mem(),
            &temp_root("none"),
            &default_source(),
            &target(),
            157,
            Some("16.18"),
            |_| std::future::ready(Err("network down".into())),
        )
        .await;

        assert!(got.is_none());
    }

    #[tokio::test]
    async fn should_not_write_disk_for_unsafe_patch() {
        let root = temp_root("unsafe");

        let got = ensure_build_impl(
            &mem(),
            &root,
            &default_source(),
            &target(),
            157,
            None,
            |_| std::future::ready(Ok(build("../evil"))),
        )
        .await;

        assert!(got.is_some(), "数据本身可用，只是不落盘");
        assert!(!root.exists());
    }
}
