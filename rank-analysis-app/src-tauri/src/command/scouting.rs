//! # 赛前威胁评级命令（command/scouting，M4 战场六）
//!
//! - `get_threat_ratings`：从当前 champ-select 会话获取敌方玩家列表，
//!   调用 scouting 引擎聚合威胁评级，返回结果。

use crate::lcu::api::champion_select::get_champion_select_session;
use crate::lcu::api::summoner::Summoner;
use crate::scouting::{assess_team_threats, PlayerInfo, ThreatRating};

/// 获取当前选人阶段敌方玩家的威胁评级。
///
/// 从 champ-select 会话读取敌方队伍（their_team），
/// 对每个敌方玩家聚合历史数据，返回威胁评级列表。
/// 敌方数据不足时降级为 Low + caveats。
#[tauri::command]
pub async fn get_threat_ratings() -> Result<Vec<ThreatRating>, String> {
    let my = Summoner::get_my_summoner()
        .await
        .map_err(|e| format!("拿不到本机召唤师: {e}"))?;

    let session = get_champion_select_session()
        .await
        .map_err(|e| format!("拿不到选人会话: {e}"))?;

    let enemies: Vec<PlayerInfo> = session
        .their_team
        .iter()
        .filter(|p| !p.puuid.is_empty())
        .map(|p| PlayerInfo {
            puuid: p.puuid.clone(),
            position: p.assigned_position.clone(),
        })
        .collect();

    if enemies.is_empty() {
        return Ok(Vec::new());
    }

    let ratings = assess_team_threats(&my.puuid, &enemies);
    Ok(ratings)
}
