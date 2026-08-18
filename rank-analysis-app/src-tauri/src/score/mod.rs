//! # 三级可下钻评分（score）
//!
//! L1 总分 + L2 维度分由 `command::score` 计算（17 分制）；本模块补 L3 事件级
//! 证据（ADR-3）：`score::events` 把低分回溯到 timeline 事件，`get_score_drilldown`
//! 命令把三者合并成 10 人下钻结果给前端 / AI 复盘引用。
//!
//! **数据链**：LCU `get_game_by_id`（L1/L2 与身份/队伍；已确认 LCU 详情**不含**
//! frames）→ SGP DETAILS timeline（L3 事件，`lcu::api::sgp::fetch_match_detail`，
//! 带局级缓存）。SGP 拉取失败 / 帧为空 → `timeline_available=false` 且事件为空，
//! 前端与 AI 按"无事件级证据"降级，不编造（ADR-2 / ADR-9）。

pub mod events;

use std::collections::{HashMap, HashSet};

use events::{compute_score_events, ScoreBreakdownDrilldown};

/// 按对局 ID 出 10 人三级下钻（L1 总分 + L2 维度分 + L3 事件证据）。
///
/// # 降级
/// - SGP timeline 不可用（拉取失败 / 无帧 / 身份对齐失败）：
///   `timeline_available=false`，事件列表为空，但 L1/L2 照常返回——下钻
///   停留在 L2，绝不用推断冒充事件证据。
#[tauri::command]
pub async fn get_score_drilldown(game_id: i64) -> Result<Vec<ScoreBreakdownDrilldown>, String> {
    let scores = crate::command::score::get_player_scores(game_id).await?;
    if scores.is_empty() {
        return Ok(Vec::new());
    }
    let game = crate::command::match_history::get_game_by_id(game_id).await?;

    let detail_resp =
        crate::lcu::api::sgp::fetch_match_detail(&game.platform_id, game_id).await;
    let (timeline_ok, detail) = match detail_resp {
        Ok(resp) => match resp.json {
            Some(d) if !d.frames.is_empty() => (true, Some(d)),
            _ => (false, None),
        },
        Err(e) => {
            log::warn!("score drilldown: SGP timeline 拉取失败: {e}");
            (false, None)
        }
    };

    // SGP participantId ↔ puuid（SGP 的 pid 与 LCU 的 pid 不一定一致，一律按
    // puuid 对齐；对齐失败的玩家事件留空，宁缺毋滥）。
    let sgp_pid_of: HashMap<String, i32> = detail.as_ref().map_or_else(HashMap::new, |d| {
        d.participants
            .iter()
            .filter_map(|p| match (&p.puuid, p.participant_id) {
                (Some(pu), Some(id)) => Some((pu.clone(), id)),
                _ => None,
            })
            .collect()
    });
    let mut team_pids: HashMap<i32, HashSet<i32>> = HashMap::new();
    for s in &scores {
        if let Some(spid) = sgp_pid_of.get(&s.puuid) {
            team_pids.entry(s.team_id).or_default().insert(*spid);
        }
    }

    let mut drills = Vec::with_capacity(scores.len());
    for s in &scores {
        let events = match (&detail, timeline_ok) {
            (Some(d), true) => sgp_pid_of.get(&s.puuid).map_or_else(Vec::new, |spid| {
                compute_score_events(
                    d,
                    *spid,
                    team_pids.get(&s.team_id).cloned().unwrap_or_default(),
                )
            }),
            _ => Vec::new(),
        };
        drills.push(ScoreBreakdownDrilldown {
            participant_id: s.participant_id,
            champion_id: s.champion_id,
            total: s.total,
            breakdown: s.breakdown.clone(),
            events,
            timeline_available: timeline_ok,
        });
    }
    Ok(drills)
}