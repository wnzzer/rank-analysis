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

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
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

/// 获取某模式快照的核心编排（命令层与启动预热共用）。
///
/// # 返回值
/// `(快照, stale)`：stale=true 表示拉取失败、返回的是过期缓存。
pub async fn ensure_opgg_snapshot(
    state: &AppState,
    mode: &str,
) -> Result<(Arc<OpggSnapshot>, bool), String> {
    if !VALID_MODES.contains(&mode) {
        return Err(format!("invalid opgg mode: {}", mode));
    }
    let now = now_secs();

    // 1. 内存 fresh
    if let Some(snap) = state.opgg_cache.get(mode).await {
        if cache::is_fresh(&snap, now) {
            return Ok((snap, false));
        }
    }

    // 2. 磁盘 fresh（跨重启复用）
    if let Some(disk) = cache::load(mode) {
        if cache::is_fresh(&disk, now) {
            let arc = Arc::new(disk);
            state.opgg_cache.insert(mode.to_string(), arc.clone()).await;
            return Ok((arc, false));
        }
    }

    // 3. HTTP 拉取
    match api::fetch_mode(mode).await {
        Ok(snap) => {
            if let Err(e) = cache::save(&snap) {
                log::warn!("OP.GG cache save failed: {}", e);
            }
            let arc = Arc::new(snap);
            state.opgg_cache.insert(mode.to_string(), arc.clone()).await;
            Ok((arc, false))
        }
        Err(e) => {
            // 4. 过期缓存降级（内存优先，其次磁盘）
            log::warn!(
                "OP.GG fetch {} failed, falling back to stale cache: {}",
                mode,
                e
            );
            if let Some(snap) = state.opgg_cache.get(mode).await {
                return Ok((snap, true));
            }
            if let Some(disk) = cache::load(mode) {
                let arc = Arc::new(disk);
                state.opgg_cache.insert(mode.to_string(), arc.clone()).await;
                return Ok((arc, true));
            }
            Err(e)
        }
    }
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
/// 快照不存在（从未成功拉取）时返回 Ok(None) 而非 Err——数据缺失是常态降级路径。
#[tauri::command]
pub async fn get_champion_meta(
    mode: String,
    champion_id: i32,
    position: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<ChampionMeta>, String> {
    match state.opgg_cache.get(&mode).await {
        Some(snap) => Ok(select_meta(&snap, champion_id, position.as_deref())),
        None => Ok(None),
    }
}

/// 批量查询多个英雄的对线克制数据（服务本局 10 英雄一次取齐）。
#[tauri::command]
pub async fn get_lane_counters(
    mode: String,
    champion_ids: Vec<i32>,
    state: State<'_, AppState>,
) -> Result<HashMap<i32, Vec<LaneCounter>>, String> {
    match state.opgg_cache.get(&mode).await {
        Some(snap) => Ok(collect_counters(&snap, &champion_ids)),
        None => Ok(HashMap::new()),
    }
}

/// 查询某模式的数据状态；从未成功拉取过返回 Ok(None)。
#[tauri::command]
pub async fn get_opgg_status(
    mode: String,
    state: State<'_, AppState>,
) -> Result<Option<OpggStatus>, String> {
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
}
