//! 规则引擎：纯函数式条件求值与规则遍历。
//!
//! 输入：当前选人会话 + 当前用户位置 + 用户配置的规则列表。
//! 输出：第一条命中且目标可执行的 action（或 None）。

use crate::command::rule_config::{
    BanAction, BanRule, PickAction, PickRule, Position, RuleCondition,
};
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

/// 求值单个条件。
pub(crate) fn match_condition(
    cond: &RuleCondition,
    session: &SelectSession,
    my_position: Option<Position>,
) -> bool {
    match cond {
        RuleCondition::Position { value } => my_position == Some(*value),
        RuleCondition::AllyChampionsContains { ids } => team_has_any(&session.my_team, ids),
        RuleCondition::AllyChampionsNotContains { ids } => !team_has_any(&session.my_team, ids),
        RuleCondition::EnemyChampionsContains { ids } => team_has_any(&session.their_team, ids),
        RuleCondition::EnemyChampionsNotContains { ids } => !team_has_any(&session.their_team, ids),
    }
}

/// 检查队伍中是否有英雄 ID 命中给定列表。championId == 0 视为"未选"，不计入。
fn team_has_any(team: &[OnePlayer], ids: &[i32]) -> bool {
    team.iter().any(|p| {
        let cid = p.champion_id;
        cid != 0 && ids.contains(&cid)
    })
}

/// 按用户拖拽顺序遍历规则，返回第一条匹配且目标可执行的 action。
///
/// "可执行" = 目标英雄未被任何人 ban（completed），且未被其他位置的玩家 hover/pick。
/// 当前用户自己之前的 hover 不阻止重新选择同一个英雄。
pub(crate) fn evaluate_pick<'a>(
    session: &SelectSession,
    my_position: Option<Position>,
    rules: &'a [PickRule],
) -> Option<&'a PickAction> {
    let unavailable = unavailable_champion_ids(session);

    for rule in rules.iter().filter(|r| r.enabled) {
        let all_match = rule
            .conditions
            .iter()
            .all(|c| match_condition(c, session, my_position));
        if !all_match {
            continue;
        }
        if !unavailable.contains(&rule.action.champion_id) {
            return Some(&rule.action);
        }
    }
    None
}

/// 收集当前选人会话中"不可选/不可 ban"的英雄 ID 集合：
/// - 任何已完成的 ban
/// - 其他位置玩家的 hover / pick（championId != 0）
/// - 当前用户自己的 hover/pick 不计入（允许重新选择同一英雄）
fn unavailable_champion_ids(session: &SelectSession) -> std::collections::HashSet<i32> {
    let my_cell = session.local_player_cell_id;
    let mut unavailable = std::collections::HashSet::new();

    for group in &session.actions {
        for a in group {
            if a.action_type == "ban" && a.completed {
                unavailable.insert(a.champion_id);
            }
            if a.action_type == "pick" && a.actor_cell_id != my_cell && a.champion_id != 0 {
                unavailable.insert(a.champion_id);
            }
        }
    }
    unavailable
}

/// 与 evaluate_pick 同语义但针对 ban 规则。
/// 返回第一条匹配且目标尚未被 ban 或被他人选/hover 的规则的 action。
///
/// 调用方需保证仅在当前玩家的 ban 回合（is_in_progress=true）调用，
/// 否则可能在错误的时机触发 ban。
pub(crate) fn evaluate_ban<'a>(
    session: &SelectSession,
    my_position: Option<Position>,
    rules: &'a [BanRule],
) -> Option<&'a BanAction> {
    let unavailable = unavailable_champion_ids(session);

    for rule in rules.iter().filter(|r| r.enabled) {
        let all_match = rule
            .conditions
            .iter()
            .all(|c| match_condition(c, session, my_position));
        if !all_match {
            continue;
        }
        if !unavailable.contains(&rule.action.champion_id) {
            return Some(&rule.action);
        }
    }
    None
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
            cell_id: 0,
            champion_pick_intent: 0,
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
        let c = RuleCondition::Position {
            value: Position::Middle,
        };
        assert!(match_condition(&c, &s, Some(Position::Middle)));
    }

    #[test]
    fn position_does_not_match_when_different() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position {
            value: Position::Middle,
        };
        assert!(!match_condition(&c, &s, Some(Position::Top)));
    }

    #[test]
    fn position_does_not_match_when_none() {
        let s = make_session(vec![]);
        let c = RuleCondition::Position {
            value: Position::Middle,
        };
        assert!(!match_condition(&c, &s, None));
    }

    fn ally_champ(champion_id: i32) -> OnePlayer {
        OnePlayer {
            champion_id,
            puuid: "x".to_string(),
            assigned_position: "".to_string(),
            cell_id: 0,
            champion_pick_intent: 0,
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

    fn enemy_champ(champion_id: i32) -> OnePlayer {
        OnePlayer {
            champion_id,
            puuid: "y".to_string(),
            assigned_position: "".to_string(),
            cell_id: 0,
            champion_pick_intent: 0,
        }
    }

    fn make_session_with_enemies(
        my_team: Vec<OnePlayer>,
        their_team: Vec<OnePlayer>,
    ) -> SelectSession {
        SelectSession {
            my_team,
            their_team,
            actions: vec![],
            timer: Default::default(),
            local_player_cell_id: 0,
        }
    }

    #[test]
    fn enemy_contains_matches_when_visible() {
        let s = make_session_with_enemies(vec![], vec![enemy_champ(238)]);
        let c = RuleCondition::EnemyChampionsContains { ids: vec![238] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_contains_does_not_match_during_ban_phase() {
        // 禁用阶段敌方 championId 均为 0，条件自然不匹配。
        let s = make_session_with_enemies(vec![], vec![enemy_champ(0), enemy_champ(0)]);
        let c = RuleCondition::EnemyChampionsContains { ids: vec![238] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_not_contains_matches_when_clean() {
        let s = make_session_with_enemies(vec![], vec![enemy_champ(1)]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![238] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_not_contains_does_not_match_when_one_present() {
        let s = make_session_with_enemies(vec![], vec![enemy_champ(238)]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![238] };
        assert!(!match_condition(&c, &s, None));
    }

    // 边缘情况（T6 审查建议补充）

    #[test]
    fn enemy_contains_does_not_match_when_their_team_empty() {
        let s = make_session_with_enemies(vec![], vec![]);
        let c = RuleCondition::EnemyChampionsContains { ids: vec![157] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn enemy_not_contains_matches_when_their_team_empty() {
        // 无敌方英雄时，取反条件空真成立。
        let s = make_session_with_enemies(vec![], vec![]);
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![157] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_with_empty_ids_returns_false() {
        // 空列表 "包含以下任意" — 结果为 false。
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsContains { ids: vec![] };
        assert!(!match_condition(&c, &s, None));
    }

    #[test]
    fn ally_not_contains_with_empty_ids_returns_true() {
        // 空列表 "不包含以下任意" — 空真成立。
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsNotContains { ids: vec![] };
        assert!(match_condition(&c, &s, None));
    }

    #[test]
    fn ally_contains_walks_full_id_list() {
        // 多 id 列表部分命中：[1, 157, 99] 中的 157 命中队友。
        let s = make_session(vec![ally_champ(157)]);
        let c = RuleCondition::AllyChampionsContains {
            ids: vec![1, 157, 99],
        };
        assert!(match_condition(&c, &s, None));
    }

    // ── evaluate_pick 测试 ──────────────────────────────────────────────────

    use crate::command::rule_config::{PickAction, PickRule};

    fn pick_rule(
        id: &str,
        conds: Vec<RuleCondition>,
        target: i32,
        lock: bool,
        enabled: bool,
    ) -> PickRule {
        PickRule {
            id: id.to_string(),
            name: id.to_string(),
            enabled,
            conditions: conds,
            action: PickAction {
                champion_id: target,
                lock,
            },
        }
    }

    fn session_with_picks_and_bans(
        my_team: Vec<OnePlayer>,
        their_team: Vec<OnePlayer>,
        actions: Vec<Vec<crate::lcu::api::champion_select::Action>>,
    ) -> SelectSession {
        SelectSession {
            my_team,
            their_team,
            actions,
            timer: Default::default(),
            local_player_cell_id: 0,
        }
    }

    #[test]
    fn evaluate_pick_returns_first_matching_rule() {
        let s = make_session(vec![player("me", "middle")]);
        let rules = vec![
            pick_rule(
                "r1",
                vec![RuleCondition::Position {
                    value: Position::Top,
                }],
                1,
                true,
                true,
            ),
            pick_rule(
                "r2",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                99,
                true,
                true,
            ),
        ];
        let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 99);
    }

    #[test]
    fn evaluate_pick_skips_disabled_rule() {
        let s = make_session(vec![player("me", "middle")]);
        let rules = vec![
            pick_rule(
                "r1",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                1,
                true,
                false,
            ),
            pick_rule(
                "r2",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                2,
                true,
                true,
            ),
        ];
        let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 2);
    }

    #[test]
    fn evaluate_pick_returns_none_when_no_rule_fits() {
        let s = make_session(vec![player("me", "middle")]);
        let rules = vec![pick_rule(
            "r1",
            vec![RuleCondition::Position {
                value: Position::Top,
            }],
            1,
            true,
            true,
        )];
        assert!(evaluate_pick(&s, Some(Position::Middle), &rules).is_none());
    }

    #[test]
    fn evaluate_pick_returns_none_when_rules_empty() {
        let s = make_session(vec![]);
        assert!(evaluate_pick(&s, None, &[]).is_none());
    }

    #[test]
    fn evaluate_pick_skips_rule_when_target_already_banned() {
        use crate::lcu::api::champion_select::Action;
        let banned = Action {
            actor_cell_id: 7,
            id: 1,
            champion_id: 99,
            completed: true,
            is_ally_action: false,
            is_in_progress: false,
            action_type: "ban".to_string(),
        };
        let s =
            session_with_picks_and_bans(vec![player("me", "middle")], vec![], vec![vec![banned]]);
        let rules = vec![
            pick_rule(
                "r1",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                99,
                true,
                true,
            ),
            pick_rule(
                "r2",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                100,
                true,
                true,
            ),
        ];
        let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 100);
    }

    #[test]
    fn evaluate_pick_skips_rule_when_target_picked_by_ally() {
        use crate::lcu::api::champion_select::Action;
        let ally_pick = Action {
            actor_cell_id: 7,
            id: 2,
            champion_id: 99,
            completed: false,
            is_ally_action: true,
            is_in_progress: false,
            action_type: "pick".to_string(),
        };
        let s = session_with_picks_and_bans(
            vec![player("me", "middle")],
            vec![],
            vec![vec![ally_pick]],
        );
        let rules = vec![
            pick_rule(
                "r1",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                99,
                true,
                true,
            ),
            pick_rule(
                "r2",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                100,
                true,
                true,
            ),
        ];
        let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 100);
    }

    #[test]
    fn evaluate_pick_ignores_own_pending_hover() {
        use crate::lcu::api::champion_select::Action;
        let my_hover = Action {
            actor_cell_id: 0, // == session.local_player_cell_id
            id: 3,
            champion_id: 99,
            completed: false,
            is_ally_action: true,
            is_in_progress: true,
            action_type: "pick".to_string(),
        };
        let s =
            session_with_picks_and_bans(vec![player("me", "middle")], vec![], vec![vec![my_hover]]);
        let rules = vec![pick_rule(
            "r1",
            vec![RuleCondition::Position {
                value: Position::Middle,
            }],
            99,
            true,
            true,
        )];
        // 自己的 hover 不应阻止重新选择同一英雄
        let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 99);
    }

    #[test]
    fn evaluate_pick_requires_all_conditions_to_match() {
        let s = make_session(vec![player("me", "middle"), ally_champ(157)]);
        let rules = vec![
            // 中路 + 自家无亚索 → 选 1（第二个条件不满足，应跳过）
            pick_rule(
                "r1",
                vec![
                    RuleCondition::Position {
                        value: Position::Middle,
                    },
                    RuleCondition::AllyChampionsNotContains { ids: vec![157] },
                ],
                1,
                true,
                true,
            ),
            // 中路 + 自家有亚索 → 选 2（应命中）
            pick_rule(
                "r2",
                vec![
                    RuleCondition::Position {
                        value: Position::Middle,
                    },
                    RuleCondition::AllyChampionsContains { ids: vec![157] },
                ],
                2,
                true,
                true,
            ),
        ];
        let action = evaluate_pick(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 2);
    }

    // ── evaluate_ban 测试 ───────────────────────────────────────────────────

    use crate::command::rule_config::{BanAction, BanRule};

    fn ban_rule(id: &str, conds: Vec<RuleCondition>, target: i32, enabled: bool) -> BanRule {
        BanRule {
            id: id.to_string(),
            name: id.to_string(),
            enabled,
            conditions: conds,
            action: BanAction {
                champion_id: target,
            },
        }
    }

    #[test]
    fn evaluate_ban_returns_first_matching() {
        let s = make_session(vec![player("me", "middle")]);
        let rules = vec![
            ban_rule(
                "b1",
                vec![RuleCondition::Position {
                    value: Position::Top,
                }],
                1,
                true,
            ),
            ban_rule(
                "b2",
                vec![RuleCondition::Position {
                    value: Position::Middle,
                }],
                89,
                true,
            ),
        ];
        let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 89);
    }

    #[test]
    fn evaluate_ban_skips_disabled() {
        let s = make_session(vec![player("me", "middle")]);
        let rules = vec![
            ban_rule("b1", vec![], 89, false),
            ban_rule("b2", vec![], 99, true),
        ];
        let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 99);
    }

    #[test]
    fn evaluate_ban_skips_target_already_banned() {
        use crate::lcu::api::champion_select::Action;
        let other_ban = Action {
            actor_cell_id: 9,
            id: 5,
            champion_id: 89,
            completed: true,
            is_ally_action: false,
            is_in_progress: false,
            action_type: "ban".to_string(),
        };
        let s = session_with_picks_and_bans(
            vec![player("me", "middle")],
            vec![],
            vec![vec![other_ban]],
        );
        let rules = vec![
            ban_rule("b1", vec![], 89, true),
            ban_rule("b2", vec![], 99, true),
        ];
        let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 99);
    }

    #[test]
    fn evaluate_ban_returns_none_when_empty() {
        let s = make_session(vec![]);
        assert!(evaluate_ban(&s, None, &[]).is_none());
    }

    #[test]
    fn evaluate_ban_ignores_own_hover_pick() {
        use crate::lcu::api::champion_select::Action;
        let my_pick_hover = Action {
            actor_cell_id: 0, // == session.local_player_cell_id
            id: 4,
            champion_id: 89,
            completed: false,
            is_ally_action: true,
            is_in_progress: true,
            action_type: "pick".to_string(),
        };
        let s = session_with_picks_and_bans(
            vec![player("me", "middle")],
            vec![],
            vec![vec![my_pick_hover]],
        );
        let rules = vec![ban_rule(
            "b1",
            vec![RuleCondition::Position {
                value: Position::Middle,
            }],
            89,
            true,
        )];
        // 自己 hover 89 不应阻止规则 ban 89
        let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 89);
    }

    #[test]
    fn evaluate_ban_requires_all_conditions_to_match() {
        let s = session_with_picks_and_bans(
            vec![player("me", "middle")],
            vec![enemy_champ(238)],
            vec![],
        );
        let rules = vec![
            // 中路 + 对面没有 Zed → ban 1（第二个条件不满足，应跳过）
            ban_rule(
                "b1",
                vec![
                    RuleCondition::Position {
                        value: Position::Middle,
                    },
                    RuleCondition::EnemyChampionsNotContains { ids: vec![238] },
                ],
                1,
                true,
            ),
            // 中路 + 对面有 Zed → ban 2（应命中）
            ban_rule(
                "b2",
                vec![
                    RuleCondition::Position {
                        value: Position::Middle,
                    },
                    RuleCondition::EnemyChampionsContains { ids: vec![238] },
                ],
                2,
                true,
            ),
        ];
        let action = evaluate_ban(&s, Some(Position::Middle), &rules).unwrap();
        assert_eq!(action.champion_id, 2);
    }
}
