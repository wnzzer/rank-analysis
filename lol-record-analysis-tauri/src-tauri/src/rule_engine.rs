//! 规则引擎：纯函数式条件求值与规则遍历。
//!
//! 输入：当前选人会话 + 当前用户位置 + 用户配置的规则列表。
//! 输出：第一条命中且目标可执行的 action（或 None）。

use crate::command::rule_config::{Position, RuleCondition};
use crate::lcu::api::champion_select::{OnePlayer, SelectSession};

/// 从选人会话中找到当前用户，读取其 `assigned_position` 并映射到 `Position`。
///
/// 大乱斗 / 普通匹配等 `assignedPosition == ""` 的场景返回 `None`，
/// 此时 `Position` 条件永远不匹配（按设计）。
pub fn detect_my_position(session: &SelectSession, my_puuid: &str) -> Option<Position> {
    let me = session.my_team.iter().find(|p| p.puuid == my_puuid)?;
    parse_position(&me.assigned_position)
}

fn parse_position(s: &str) -> Option<Position> {
    match s.to_ascii_lowercase().as_str() {
        "top" => Some(Position::Top),
        "jungle" => Some(Position::Jungle),
        "middle" => Some(Position::Middle),
        "bottom" => Some(Position::Bottom),
        "utility" => Some(Position::Utility),
        _ => None,
    }
}

/// 求值单个条件。其余 variant 在后续任务中补全（T7 enemy）。
// T10/T11 will call this from production code; suppress until then.
#[allow(dead_code)]
pub(crate) fn match_condition(
    cond: &RuleCondition,
    session: &SelectSession,
    my_position: Option<Position>,
) -> bool {
    match cond {
        RuleCondition::Position { value } => my_position == Some(*value),
        RuleCondition::AllyChampionsContains { ids } => team_has_any(&session.my_team, ids),
        RuleCondition::AllyChampionsNotContains { ids } => !team_has_any(&session.my_team, ids),
        // T7 will add EnemyChampions* arms
        _ => false,
    }
}

/// 检查队伍中是否有英雄 ID 命中给定列表。championId == 0 视为"未选"，不计入。
fn team_has_any(team: &[OnePlayer], ids: &[i32]) -> bool {
    team.iter().any(|p| {
        let cid = p.champion_id;
        cid != 0 && ids.contains(&cid)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(my_team: Vec<OnePlayer>) -> SelectSession {
        SelectSession {
            my_team,
            their_team: vec![],
            actions: vec![],
            timer: Default::default(),
            local_player_cell_id: 0,
        }
    }

    fn player(puuid: &str, position: &str) -> OnePlayer {
        OnePlayer {
            champion_id: 0,
            puuid: puuid.to_string(),
            assigned_position: position.to_string(),
        }
    }

    #[test]
    fn detect_my_position_when_assigned() {
        let s = make_session(vec![player("me", "middle")]);
        assert_eq!(detect_my_position(&s, "me"), Some(Position::Middle));
    }

    #[test]
    fn detect_my_position_returns_none_for_empty_assigned() {
        let s = make_session(vec![player("me", "")]);
        assert_eq!(detect_my_position(&s, "me"), None);
    }

    #[test]
    fn detect_my_position_returns_none_when_puuid_not_found() {
        let s = make_session(vec![player("other", "middle")]);
        assert_eq!(detect_my_position(&s, "me"), None);
    }

    #[test]
    fn detect_my_position_handles_uppercase_lcu_strings() {
        let s = make_session(vec![player("me", "JUNGLE")]);
        assert_eq!(detect_my_position(&s, "me"), Some(Position::Jungle));
    }

    #[test]
    fn position_matches_when_equal() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position { value: Position::Middle };
        assert!(match_condition(&c, &s, Some(Position::Middle)));
    }

    #[test]
    fn position_does_not_match_when_different() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position { value: Position::Middle };
        assert!(!match_condition(&c, &s, Some(Position::Top)));
    }

    #[test]
    fn position_does_not_match_when_none() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position { value: Position::Middle };
        assert!(!match_condition(&c, &s, None));
    }

    fn ally_champ(champion_id: i32) -> OnePlayer {
        OnePlayer {
            champion_id,
            puuid: "x".to_string(),
            assigned_position: "".to_string(),
        }
    }

    #[test]
    fn ally_contains_matches_when_at_least_one_ally_has_id() {
        let s = make_session(vec![ally_champ(1), ally_champ(157)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![157] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_counts_hovered_champion() {
        // championId != 0 means hovered or locked — both count.
        let s = make_session(vec![ally_champ(238)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![238] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_ignores_zero_champion_id() {
        // championId == 0 means "no hover yet" — should NOT match.
        let s = make_session(vec![ally_champ(0)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![0] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_does_not_match_when_no_ally_has_id() {
        let s = make_session(vec![ally_champ(1), ally_champ(2)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![157] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn ally_not_contains_matches_when_team_is_clean() {
        let s = make_session(vec![ally_champ(1), ally_champ(2)]);
        let c = RuleCondition::AllyChampionsNotContains { ids: vec![157] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_not_contains_does_not_match_when_one_present() {
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsNotContains { ids: vec![157] };
        assert!(!match_condition(&c, &s, None));
    }
}
