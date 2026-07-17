//! # OP.GG 命令模块
//!
//! 暴露 OP.GG 英雄数据给前端：更新快照、查英雄元数据、批量查对线克制、查数据状态。
//!
//! ## 降级链
//!
//! `ensure_opgg_snapshot`：内存 fresh → 磁盘 fresh → HTTP 拉取 →
//! 过期缓存（标 `stale=true`）→ 全无则 Err。数据缺失不应阻塞任何上层功能，
//! 前端拿到 Err/None 时隐藏相关 UI、AI prompt 跳过版本情报块即可。

use crate::opgg::data::{ChampionMeta, LaneCounter, OpggSnapshot};
use crate::opgg::{api, cache};
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// 允许的模式白名单。
const VALID_MODES: [&str; 2] = ["ranked", "aram"];

/// OP.GG 数据状态（供设置页与对局页横幅展示）。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpggStatus {
    /// 模式
    pub mode: String,
    /// patch 版本号
    pub patch: String,
    /// 拉取时间（unix 秒）
    pub fetched_at: i64,
    /// 是否过期数据（拉取失败降级）
    pub stale: bool,
    /// 覆盖英雄数
    pub champion_count: usize,
}

/// 当前 unix 秒；系统时钟异常时返回 0。
fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 校验模式是否在白名单（"ranked"/"aram"）内。
///
/// # 参数
/// - `mode`: 待校验的模式字符串
///
/// # 错误
/// 不在白名单时返回 Err，消息附带合法取值提示。
fn validate_mode(mode: &str) -> Result<(), String> {
    if VALID_MODES.contains(&mode) {
        Ok(())
    } else {
        Err(format!(
            "invalid opgg mode: {} (expected ranked|aram)",
            mode
        ))
    }
}

/// 从快照生成状态对象。
fn snapshot_status(snap: &OpggSnapshot, stale: bool) -> OpggStatus {
    OpggStatus {
        mode: snap.mode.clone(),
        patch: snap.patch.clone(),
        fetched_at: snap.fetched_at,
        stale,
        champion_count: snap.champions.len(),
    }
}

/// 查某英雄的元数据：指定分路精确命中 → 回退主分路 → None。
fn select_meta(
    snap: &OpggSnapshot,
    champion_id: i32,
    position: Option<&str>,
) -> Option<ChampionMeta> {
    let metas = snap.champions.get(&champion_id)?;
    if let Some(pos) = position {
        if let Some(m) = metas.iter().find(|m| m.position == pos) {
            return Some(m.clone());
        }
    }
    metas
        .iter()
        .find(|m| m.is_main_position)
        .or_else(|| metas.first())
        .cloned()
}

/// 批量收集指定英雄的克制数据（快照中没有的英雄直接缺席结果）。
fn collect_counters(snap: &OpggSnapshot, champion_ids: &[i32]) -> HashMap<i32, Vec<LaneCounter>> {
    champion_ids
        .iter()
        .filter_map(|id| snap.counters.get(id).map(|v| (*id, v.clone())))
        .collect()
}

/// 降级链编排的可注入实现（供单测注入假 fetch / 假磁盘）。
///
/// 与 [`ensure_opgg_snapshot`] 行为完全一致，仅把外部效应
/// （HTTP 拉取、磁盘读写、当前时间）参数化。
///
/// # 参数
/// - `mem_cache`: 内存缓存（无 TTL，保留最后已知快照供降级）
/// - `now`: 当前 unix 秒（新鲜度判定基准）
/// - `fetch`: HTTP 拉取（生产为 `api::fetch_mode`）
/// - `disk_load` / `disk_save`: 磁盘缓存读写（生产为 `cache::load` / `cache::save`）
async fn ensure_snapshot_impl<F, Fut>(
    mem_cache: &moka::future::Cache<String, Arc<OpggSnapshot>>,
    mode: &str,
    now: i64,
    fetch: F,
    disk_load: impl Fn(&str) -> Option<OpggSnapshot>,
    disk_save: impl Fn(&OpggSnapshot) -> Result<(), String>,
) -> Result<(Arc<OpggSnapshot>, bool), String>
where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<OpggSnapshot, String>>,
{
    validate_mode(mode)?;

    // 1. 内存 fresh
    if let Some(snap) = mem_cache.get(mode).await {
        if cache::is_fresh(&snap, now) {
            return Ok((snap, false));
        }
    }

    // 2. 磁盘 fresh（跨重启复用）
    if let Some(disk) = disk_load(mode) {
        if cache::is_fresh(&disk, now) {
            let arc = Arc::new(disk);
            mem_cache.insert(mode.to_string(), arc.clone()).await;
            return Ok((arc, false));
        }
    }

    // 3. HTTP 拉取
    match fetch(mode.to_string()).await {
        Ok(snap) => {
            if let Err(e) = disk_save(&snap) {
                log::warn!("OP.GG cache save failed: {}", e);
            }
            let arc = Arc::new(snap);
            mem_cache.insert(mode.to_string(), arc.clone()).await;
            Ok((arc, false))
        }
        Err(e) => {
            // 4. 过期缓存降级（内存优先，其次磁盘）
            log::warn!(
                "OP.GG fetch {} failed, falling back to stale cache: {}",
                mode,
                e
            );
            if let Some(snap) = mem_cache.get(mode).await {
                return Ok((snap, true));
            }
            if let Some(disk) = disk_load(mode) {
                let arc = Arc::new(disk);
                mem_cache.insert(mode.to_string(), arc.clone()).await;
                return Ok((arc, true));
            }
            Err(e)
        }
    }
}

/// 获取某模式快照的核心编排（命令层与启动预热共用）。
///
/// # 返回值
/// `(快照, stale)`：stale=true 表示拉取失败、返回的是过期缓存。
pub async fn ensure_opgg_snapshot(
    state: &AppState,
    mode: &str,
) -> Result<(Arc<OpggSnapshot>, bool), String> {
    ensure_snapshot_impl(
        &state.opgg_cache,
        mode,
        now_secs(),
        |m| async move { api::fetch_mode(&m).await },
        cache::load,
        cache::save,
    )
    .await
}

/// 更新（或确保）某模式的 OP.GG 数据，返回数据状态。
#[tauri::command]
pub async fn update_opgg_data(
    mode: String,
    state: State<'_, AppState>,
) -> Result<OpggStatus, String> {
    let (snap, stale) = ensure_opgg_snapshot(&state, &mode).await?;
    Ok(snapshot_status(&snap, stale))
}

/// 查询单英雄元数据（T级/胜率等）。position 传 LCU 命名（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY）。
///
/// 非法模式（不在 ranked/aram 白名单）返回 Err；数据未拉取仍是 Ok(None)——
/// 数据缺失是常态降级路径，不应与参数错误混淆。
#[tauri::command]
pub async fn get_champion_meta(
    mode: String,
    champion_id: i32,
    position: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<ChampionMeta>, String> {
    validate_mode(&mode)?;
    match state.opgg_cache.get(&mode).await {
        Some(snap) => Ok(select_meta(&snap, champion_id, position.as_deref())),
        None => Ok(None),
    }
}

/// 批量查询多个英雄的对线克制数据（服务本局 10 英雄一次取齐）。
///
/// 非法模式返回 Err；数据未拉取仍是 Ok(空 map)。
#[tauri::command]
pub async fn get_lane_counters(
    mode: String,
    champion_ids: Vec<i32>,
    state: State<'_, AppState>,
) -> Result<HashMap<i32, Vec<LaneCounter>>, String> {
    validate_mode(&mode)?;
    match state.opgg_cache.get(&mode).await {
        Some(snap) => Ok(collect_counters(&snap, &champion_ids)),
        None => Ok(HashMap::new()),
    }
}

/// 查询某模式的数据状态。
///
/// 非法模式返回 Err；从未成功拉取过仍是 Ok(None)。
#[tauri::command]
pub async fn get_opgg_status(
    mode: String,
    state: State<'_, AppState>,
) -> Result<Option<OpggStatus>, String> {
    validate_mode(&mode)?;
    let now = now_secs();
    match state.opgg_cache.get(&mode).await {
        Some(snap) => {
            let stale = !cache::is_fresh(&snap, now);
            Ok(Some(snapshot_status(&snap, stale)))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opgg::data::{ChampionMeta, LaneCounter, OpggSnapshot};
    use std::collections::HashMap;

    fn meta(champion_id: i32, position: &str, is_main: bool) -> ChampionMeta {
        ChampionMeta {
            champion_id,
            position: position.into(),
            tier: 1,
            rank: 1,
            rank_prev_patch: 0,
            win_rate: 0.52,
            pick_rate: 0.1,
            ban_rate: 0.05,
            role_rate: 0.8,
            is_main_position: is_main,
        }
    }

    fn snapshot() -> OpggSnapshot {
        let mut champions = HashMap::new();
        champions.insert(86, vec![meta(86, "TOP", true), meta(86, "MIDDLE", false)]);
        let mut counters = HashMap::new();
        counters.insert(
            86,
            vec![LaneCounter {
                opponent_id: 10,
                position: "TOP".into(),
                subject_win_rate: 0.447,
                play: 4710,
            }],
        );
        OpggSnapshot {
            mode: "ranked".into(),
            patch: "16.13".into(),
            fetched_at: 1_752_000_000,
            champions,
            counters,
        }
    }

    #[test]
    fn select_meta_should_prefer_exact_position_then_main() {
        let snap = snapshot();
        // 指定分路精确命中
        let m = select_meta(&snap, 86, Some("MIDDLE")).unwrap();
        assert_eq!(m.position, "MIDDLE");
        // 指定分路无数据 → 回退主分路
        let m = select_meta(&snap, 86, Some("UTILITY")).unwrap();
        assert_eq!(m.position, "TOP");
        // 不指定分路 → 主分路
        let m = select_meta(&snap, 86, None).unwrap();
        assert_eq!(m.position, "TOP");
        // 未知英雄 → None
        assert!(select_meta(&snap, 12345, None).is_none());
    }

    #[test]
    fn collect_counters_should_only_include_requested_ids() {
        let snap = snapshot();
        let got = collect_counters(&snap, &[86, 999]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[&86][0].opponent_id, 10);
    }

    #[test]
    fn status_should_reflect_snapshot() {
        let s = snapshot_status(&snapshot(), true);
        assert_eq!(s.mode, "ranked");
        assert_eq!(s.patch, "16.13");
        assert!(s.stale);
        assert_eq!(s.champion_count, 1);
    }

    #[test]
    fn validate_mode_should_accept_whitelisted_and_reject_others() {
        assert!(validate_mode("ranked").is_ok());
        assert!(validate_mode("aram").is_ok());

        let err = validate_mode("urf").unwrap_err();
        assert!(err.contains("invalid opgg mode"));
        assert!(err.contains("expected ranked|aram"));
    }

    // ---- ensure_snapshot_impl（降级链编排）----

    use crate::opgg::cache::TTL_SECS;
    use std::sync::atomic::{AtomicBool, Ordering};

    /// 测试基准时刻。
    const NOW: i64 = 2_000_000_000;

    /// 指定拉取时刻的快照（内容复用 [`snapshot`]）。
    fn snapshot_at(fetched_at: i64) -> OpggSnapshot {
        OpggSnapshot {
            fetched_at,
            ..snapshot()
        }
    }

    /// 空内存缓存（与 `AppState::opgg_cache` 同构：无 TTL）。
    fn mem_cache() -> moka::future::Cache<String, Arc<OpggSnapshot>> {
        moka::future::Cache::builder().build()
    }

    /// 恒不命中的磁盘读。
    fn disk_none(_mode: &str) -> Option<OpggSnapshot> {
        None
    }

    /// 恒成功的磁盘写。
    fn disk_save_ok(_snap: &OpggSnapshot) -> Result<(), String> {
        Ok(())
    }

    #[tokio::test]
    async fn ensure_should_return_fresh_memory_without_fetching() {
        let cache_map = mem_cache();
        cache_map
            .insert("ranked".into(), Arc::new(snapshot_at(NOW - 100)))
            .await;

        let fetch_called = AtomicBool::new(false);
        let (snap, stale) = ensure_snapshot_impl(
            &cache_map,
            "ranked",
            NOW,
            |_m| {
                fetch_called.store(true, Ordering::SeqCst);
                async { Err::<OpggSnapshot, String>("should not fetch".into()) }
            },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(
            !fetch_called.load(Ordering::SeqCst),
            "内存 fresh 不应触发拉取"
        );
        assert!(!stale);
        assert_eq!(snap.fetched_at, NOW - 100);
    }

    #[tokio::test]
    async fn ensure_should_promote_fresh_disk_without_fetching() {
        let cache_map = mem_cache();

        let fetch_called = AtomicBool::new(false);
        let (snap, stale) = ensure_snapshot_impl(
            &cache_map,
            "ranked",
            NOW,
            |_m| {
                fetch_called.store(true, Ordering::SeqCst);
                async { Err::<OpggSnapshot, String>("should not fetch".into()) }
            },
            |_mode| Some(snapshot_at(NOW - 100)),
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(
            !fetch_called.load(Ordering::SeqCst),
            "磁盘 fresh 不应触发拉取"
        );
        assert!(!stale);
        assert_eq!(snap.fetched_at, NOW - 100);
        // 磁盘命中应回填内存，后续查询命令可复用
        let cached = cache_map
            .get("ranked")
            .await
            .expect("磁盘 fresh 应写入内存");
        assert_eq!(cached.fetched_at, NOW - 100);
    }

    #[tokio::test]
    async fn ensure_should_fetch_and_cache_on_success() {
        let cache_map = mem_cache();
        let saved = AtomicBool::new(false);

        let (snap, stale) = ensure_snapshot_impl(
            &cache_map,
            "ranked",
            NOW,
            |_m| async { Ok(snapshot_at(NOW)) },
            disk_none,
            |_s| {
                saved.store(true, Ordering::SeqCst);
                Ok(())
            },
        )
        .await
        .unwrap();

        assert!(!stale);
        assert_eq!(snap.fetched_at, NOW);
        assert!(saved.load(Ordering::SeqCst), "拉取成功应落盘");
        let cached = cache_map.get("ranked").await.expect("拉取成功应写入内存");
        assert_eq!(cached.fetched_at, NOW);
    }

    #[tokio::test]
    async fn ensure_should_fall_back_to_stale_memory_on_fetch_failure() {
        let cache_map = mem_cache();
        // 过期快照仍留在内存（opgg_cache 无 TTL 的意义所在）
        cache_map
            .insert("ranked".into(), Arc::new(snapshot_at(NOW - TTL_SECS - 100)))
            .await;

        let (snap, stale) = ensure_snapshot_impl(
            &cache_map,
            "ranked",
            NOW,
            |_m| async { Err::<OpggSnapshot, String>("network down".into()) },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(stale, "拉取失败回退过期内存应标 stale");
        assert_eq!(snap.fetched_at, NOW - TTL_SECS - 100);
    }

    #[tokio::test]
    async fn ensure_should_fall_back_to_stale_disk_on_fetch_failure() {
        let cache_map = mem_cache();

        let (snap, stale) = ensure_snapshot_impl(
            &cache_map,
            "ranked",
            NOW,
            |_m| async { Err::<OpggSnapshot, String>("network down".into()) },
            |_mode| Some(snapshot_at(NOW - TTL_SECS - 100)),
            disk_save_ok,
        )
        .await
        .unwrap();

        assert!(stale, "拉取失败回退过期磁盘应标 stale");
        assert_eq!(snap.fetched_at, NOW - TTL_SECS - 100);
        // 降级结果也应写入内存，后续查询命令可用
        assert!(cache_map.get("ranked").await.is_some());
    }

    #[tokio::test]
    async fn ensure_should_err_when_fetch_fails_and_no_cache_anywhere() {
        let cache_map = mem_cache();

        let err = ensure_snapshot_impl(
            &cache_map,
            "ranked",
            NOW,
            |_m| async { Err::<OpggSnapshot, String>("network down".into()) },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap_err();

        assert_eq!(err, "network down");
    }

    #[tokio::test]
    async fn ensure_should_reject_invalid_mode() {
        let cache_map = mem_cache();

        let fetch_called = AtomicBool::new(false);
        let err = ensure_snapshot_impl(
            &cache_map,
            "urf",
            NOW,
            |_m| {
                fetch_called.store(true, Ordering::SeqCst);
                async { Err::<OpggSnapshot, String>("should not fetch".into()) }
            },
            disk_none,
            disk_save_ok,
        )
        .await
        .unwrap_err();

        assert!(err.contains("invalid opgg mode"));
        assert!(!fetch_called.load(Ordering::SeqCst));
    }
}
