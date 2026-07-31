//! BP 决策求值：纯函数，OP.GG snapshot 作为参数注入。

use crate::bp_decision::types::{BpActionType, MyPendingAction, Unavailable};
use crate::lcu::api::champion_select::{SelectSession, Timer};
use std::collections::HashMap;

/// LCU 的 `adjustedTimeLeftInPhase` 以**毫秒**返回，转成秒。
///
/// 真机核对见 Task 3 Step 8——若实测为秒，改这里一处即可。
pub fn phase_secs_left(timer: &Timer) -> f64 {
    timer.adjusted_time_left_in_phase / 1000.0
}

/// 找到当前用户尚未完成的那个 BP 动作。
///
/// 优先返回 `is_in_progress` 的（轮到我了），否则返回第一个未完成的
/// （预选期：pick action 已存在但还没轮到我，此时仍应 hover）。
pub fn find_my_pending_action(session: &SelectSession) -> Option<MyPendingAction> {
    let my_cell = session.local_player_cell_id;
    let mut fallback: Option<MyPendingAction> = None;

    for group in &session.actions {
        for a in group {
            if a.actor_cell_id != my_cell || a.completed {
                continue;
            }
            let action_type = match a.action_type.as_str() {
                "ban" => BpActionType::Ban,
                "pick" => BpActionType::Pick,
                _ => continue,
            };
            let pending = MyPendingAction {
                action_id: a.id,
                action_type,
                is_in_progress: a.is_in_progress,
                champion_id: a.champion_id,
            };
            if a.is_in_progress {
                return Some(pending);
            }
            if fallback.is_none() {
                fallback = Some(pending);
            }
        }
    }
    fallback
}

/// 收集当前会话中不可选 / 不可 ban 的英雄，并保留原因。
///
/// 与 `rule_engine::unavailable_champion_ids` 同语义，但**不合并原因**——
/// 决策带要区分「已被 ban」和「已被他人选走」，且后者要分清我方还是对面。
/// 当前用户自己的 hover/pick 不计入（允许重新选择同一英雄）。
pub fn unavailable_map(session: &SelectSession) -> HashMap<i32, Unavailable> {
    let my_cell = session.local_player_cell_id;
    let mut map = HashMap::new();

    for group in &session.actions {
        for a in group {
            if a.action_type == "ban" && a.completed {
                map.insert(a.champion_id, Unavailable::Banned);
            }
            if a.action_type == "pick" && a.actor_cell_id != my_cell && a.champion_id != 0 {
                map.entry(a.champion_id).or_insert(Unavailable::Taken {
                    by_ally: a.is_ally_action,
                });
            }
        }
    }
    map
}

/// 用户接管检测。
///
/// 记住我们最后一次 hover 的英雄 ID；若我方 pick/ban action 的 championId
/// 既非 0 又不等于该值，判定用户已接管。我们从未 hover 过时永不判定——
/// 否则刚开启自动化就会把用户已有的 hover 误判成接管。
pub fn detect_override(current_hover: i32, last_hovered: Option<i32>) -> bool {
    match last_hovered {
        Some(ours) => current_hover != 0 && current_hover != ours,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bp_decision::types::{BpActionType, Unavailable};
    use crate::lcu::api::champion_select::{Action, SelectSession, Timer};

    fn action(
        actor: i32,
        id: i32,
        champ: i32,
        completed: bool,
        in_progress: bool,
        ty: &str,
        ally: bool,
    ) -> Action {
        Action {
            actor_cell_id: actor,
            id,
            champion_id: champ,
            completed,
            is_ally_action: ally,
            is_in_progress: in_progress,
            action_type: ty.to_string(),
        }
    }

    fn session(actions: Vec<Vec<Action>>) -> SelectSession {
        SelectSession {
            my_team: vec![],
            their_team: vec![],
            actions,
            timer: Timer::default(),
            local_player_cell_id: 0,
        }
    }

    #[test]
    fn find_pending_should_prefer_in_progress_action() {
        // 我有一个未完成的 pick（预选期）和一个进行中的 ban
        let s = session(vec![
            vec![action(0, 10, 0, false, false, "pick", true)],
            vec![action(0, 11, 0, false, true, "ban", true)],
        ]);
        let p = find_my_pending_action(&s).unwrap();
        assert_eq!(p.action_id, 11);
        assert_eq!(p.action_type, BpActionType::Ban);
        assert!(p.is_in_progress);
    }

    #[test]
    fn find_pending_should_fall_back_to_not_yet_started_action() {
        // 预选期：pick action 存在但还没轮到我
        let s = session(vec![vec![action(0, 10, 0, false, false, "pick", true)]]);
        let p = find_my_pending_action(&s).unwrap();
        assert_eq!(p.action_id, 10);
        assert_eq!(p.action_type, BpActionType::Pick);
        assert!(!p.is_in_progress);
        assert_eq!(p.champion_id, 0);
    }

    #[test]
    fn find_pending_should_ignore_completed_and_others() {
        let s = session(vec![vec![
            action(0, 10, 64, true, false, "pick", true), // 我的，已完成
            action(3, 11, 0, false, true, "pick", true),  // 别人的
        ]]);
        assert!(find_my_pending_action(&s).is_none());
    }

    #[test]
    fn unavailable_map_should_separate_banned_from_taken() {
        let s = session(vec![vec![
            action(5, 20, 157, true, false, "ban", false), // 对面 ban 了亚索
            action(1, 21, 64, false, false, "pick", true), // 队友 hover 了盲僧
            action(7, 22, 99, false, false, "pick", false), // 对面 hover 了拉克丝
            action(0, 23, 89, false, false, "pick", true), // 我自己的 hover，不算不可用
        ]]);
        let m = unavailable_map(&s);
        assert_eq!(m.get(&157), Some(&Unavailable::Banned));
        assert_eq!(m.get(&64), Some(&Unavailable::Taken { by_ally: true }));
        assert_eq!(m.get(&99), Some(&Unavailable::Taken { by_ally: false }));
        assert!(!m.contains_key(&89), "自己的 hover 不应阻挡自己");
    }

    #[test]
    fn detect_override_only_when_we_hovered_and_user_changed_it() {
        assert!(
            detect_override(157, Some(64)),
            "我们 hover 盲僧、变成亚索 → 接管"
        );
        assert!(!detect_override(64, Some(64)), "没变 → 不接管");
        assert!(!detect_override(0, Some(64)), "撤回成 0 → 不接管");
        assert!(!detect_override(157, None), "我们从未 hover 过 → 不判定");
    }

    #[test]
    fn phase_secs_left_converts_lcu_milliseconds() {
        let t = Timer {
            adjusted_time_left_in_phase: 27_500.0,
            ..Default::default()
        };
        assert!((phase_secs_left(&t) - 27.5).abs() < 1e-9);
    }
}
