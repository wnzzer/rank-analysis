//! # 赛前威胁评级命令（command/scouting，M4 战场六）
//!
//! - `get_threat_ratings`：从当前 champ-select 会话获取敌方玩家列表，
//!   调用 scouting 引擎聚合威胁评级，返回结果。

use crate::lcu::api::champion_select::get_champion_select_session;
use crate::lcu::api::champion_select::OnePlayer;
use crate::lcu::api::summoner::Summoner;
use crate::scouting::{assess_team_threats, PlayerInfo, ThreatRating};

/// 还原敌方玩家真实 puuid。
///
/// 选人期 LCU 对排位下发混淆 puuid（真实 puuid 匿名为空），需用
/// `deobfuscate_puuid` 还原（口径同 `command::session::champ_select_to_one_player`）。
/// 优先级：真实 puuid → 混淆还原 → `None`（无身份信息则跳过该玩家，不编造）。
fn resolve_enemy_puuid(p: &OnePlayer) -> Option<String> {
    if !p.puuid.is_empty() {
        return Some(p.puuid.clone());
    }
    if p.obfuscated_puuid.is_empty() {
        return None;
    }
    crate::lcu::util::uuid::deobfuscate_puuid(&p.obfuscated_puuid).ok()
}

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
        .filter_map(|p| {
            resolve_enemy_puuid(p).map(|puuid| PlayerInfo {
                puuid,
                position: p.assigned_position.clone(),
            })
        })
        .collect();

    if enemies.is_empty() {
        return Ok(Vec::new());
    }

    let ratings = assess_team_threats(&my.puuid, &enemies);
    Ok(ratings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(puuid: &str, obfuscated: &str) -> OnePlayer {
        OnePlayer {
            champion_id: 1,
            puuid: puuid.to_string(),
            obfuscated_puuid: obfuscated.to_string(),
            assigned_position: "TOP".to_string(),
            cell_id: 5,
            champion_pick_intent: 0,
        }
    }

    #[test]
    fn should_keep_real_puuid_when_present() {
        let p = player("real-puuid-123", "obfuscated-abc");
        assert_eq!(resolve_enemy_puuid(&p).as_deref(), Some("real-puuid-123"));
    }

    #[test]
    fn should_skip_player_without_any_identity() {
        let p = player("", "");
        assert_eq!(resolve_enemy_puuid(&p), None);
    }

    #[test]
    fn should_not_fabricate_puuid_when_deobfuscation_fails() {
        // 乱码混淆串还原必失败 → 宁可跳过也不编造身份
        let p = player("", "not-a-uuid");
        assert_eq!(resolve_enemy_puuid(&p), None);
    }
}
