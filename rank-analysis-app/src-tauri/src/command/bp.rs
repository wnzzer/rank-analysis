//! # BP 决策命令模块
//!
//! 把 automation 常驻任务算好的决策快照与操作台快照暴露给前端，
//! 并提供操作台的两个手动动作：预选、确认。
//!
//! 两个读取命令纯读进程内静态存储，无 I/O、无锁等待，前端可安心高频轮询。
//! 两个手动动作会写 LCU：
//! - 预选 = 换人选。自动化**不退让**，到点照常执行，只是执行的是用户点的这个英雄。
//!   （用户去客户端里自己换英雄才算接管，那由 automation 的接管检测负责。）
//! - 确认 = 立刻提交，动作就此完成。

use crate::bp_decision::panel::BpPanel;
use crate::bp_decision::types::{BpActionType, BpDecision, MyPendingAction, Unavailable};
use crate::bp_decision::{evaluate, store};
use crate::lcu::api::champion_select::{
    get_fresh_champion_select_session, patch_session_action, SelectSession,
};

/// 读取当前 BP 决策快照。
///
/// # 返回值
/// - `Ok(Some(_))`: 选人期且有属于我的待办 BP 动作
/// - `Ok(None)`: 非选人期、我的回合已完成，或快照尚未生成
#[tauri::command]
pub async fn get_bp_decision() -> Result<Option<BpDecision>, String> {
    Ok(store::read())
}

/// 读取当前 BP 操作台快照（候选打分 + 面板状态）。
///
/// # 返回值
/// - `Ok(Some(_))`: 选人期且会话里有属于我的 BP 动作
/// - `Ok(None)`: 非选人期、没有我的动作，或快照尚未生成
#[tauri::command]
pub async fn get_bp_panel() -> Result<Option<BpPanel>, String> {
    Ok(store::read_panel())
}

/// 手动操作前的共同步骤：取实时会话，定位我当前的待办动作。
async fn my_pending() -> Result<(SelectSession, MyPendingAction), String> {
    let session = get_fresh_champion_select_session().await?;
    let pending =
        evaluate::find_my_pending_action(&session).ok_or("当前没有需要你操作的 BP 动作")?;
    Ok((session, pending))
}

/// 该英雄现在不能选 / 不能禁的原因；可用时返回 None。
fn unavailable_reason(session: &SelectSession, champion_id: i32) -> Option<&'static str> {
    match evaluate::unavailable_map(session).get(&champion_id)? {
        Unavailable::Banned => Some("该英雄已被禁用"),
        Unavailable::Taken { .. } => Some("该英雄已被选走"),
    }
}

fn action_name(action_type: BpActionType) -> &'static str {
    match action_type {
        BpActionType::Ban => "ban",
        BpActionType::Pick => "pick",
    }
}

/// 把一个英雄定为本动作的人选，并在客户端里预选它（可撤回、可再换）。
///
/// 还没轮到我时也可以调用：pick 会在客户端里亮出意向，ban 只记下人选。
/// 自动化开着的话，到点执行的就是这个英雄。
///
/// # 参数
/// - `champion_id`: 要预选的英雄
///
/// # 错误
/// - 当前没有属于我的待办 BP 动作
/// - 英雄已被禁用 / 选走
/// - 客户端拒绝了预选请求
#[tauri::command]
pub async fn bp_hover(champion_id: i32) -> Result<(), String> {
    let (session, pending) = my_pending().await?;
    if let Some(reason) = unavailable_reason(&session, champion_id) {
        return Err(reason.to_string());
    }
    // 人选先记下、并记成「我们 hover 的」，再去写客户端：执行侧每秒读一次，顺序反过来
    // 的话它会在这一秒的空档里把客户端里的预选认成「用户在客户端里换了英雄」而判接管
    store::set_manual_target(pending.action_id, champion_id);
    store::set_last_hovered(Some(champion_id));
    let patched = patch_session_action(
        pending.action_id,
        champion_id,
        action_name(pending.action_type).to_string(),
        false,
    )
    .await;
    if let Err(e) = patched {
        // ban 的预选能否生效尚未在所有队列下验证过（见 automation::BAN_HOVER_ENABLED）。
        // 失败不算错误：面板本地已经记住了用户的选择，确认时会带着英雄 ID 提交。
        if pending.action_type == BpActionType::Ban {
            log::warn!("BP manual ban hover ignored by client: {}", e);
            return Ok(());
        }
        return Err(e);
    }
    Ok(())
}

/// 确认一个英雄（锁定 / 禁用，不可撤回）。
///
/// 带上英雄 ID 而不是「确认当前预选」：预选请求可能没成功（ban 阶段的预选在部分
/// 队列下会被客户端忽略），确认时以用户在面板上看到的那个为准。
///
/// # 参数
/// - `champion_id`: 要锁定 / 禁用的英雄
///
/// # 错误
/// - 还没轮到我，或当前阶段提交无效
/// - 英雄已被禁用 / 选走
/// - 客户端拒绝了请求
#[tauri::command]
pub async fn bp_confirm(champion_id: i32) -> Result<(), String> {
    let (session, pending) = my_pending().await?;
    if !pending.is_in_progress || !evaluate::is_actionable_phase(&session.timer.phase) {
        return Err("还没轮到你操作".to_string());
    }
    if let Some(reason) = unavailable_reason(&session, champion_id) {
        return Err(reason.to_string());
    }
    // 用户亲手提交：自动化在这个动作上不该再做任何事（哪怕这次提交被客户端拒绝）
    store::mark_overridden(pending.action_id);
    patch_session_action(
        pending.action_id,
        champion_id,
        action_name(pending.action_type).to_string(),
        true,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::champion_select::{Action, Timer};

    fn session(actions: Vec<Action>) -> SelectSession {
        SelectSession {
            my_team: Vec::new(),
            their_team: Vec::new(),
            actions: vec![actions],
            timer: Timer::default(),
            local_player_cell_id: 0,
        }
    }

    fn action(cell: i32, ty: &str, champion_id: i32, completed: bool) -> Action {
        Action {
            actor_cell_id: cell,
            id: cell,
            champion_id,
            completed,
            is_ally_action: cell < 5,
            is_in_progress: false,
            action_type: ty.to_string(),
        }
    }

    #[test]
    fn should_explain_why_champion_is_unavailable() {
        let s = session(vec![
            action(5, "ban", 238, true),
            action(6, "pick", 103, true),
            action(0, "pick", 90, false),
        ]);

        assert_eq!(unavailable_reason(&s, 238), Some("该英雄已被禁用"));
        assert_eq!(unavailable_reason(&s, 103), Some("该英雄已被选走"));
        // 我自己正预选的英雄不算被占
        assert_eq!(unavailable_reason(&s, 90), None);
        assert_eq!(unavailable_reason(&s, 1), None);
    }

    #[test]
    fn should_name_lcu_action_type() {
        assert_eq!(action_name(BpActionType::Ban), "ban");
        assert_eq!(action_name(BpActionType::Pick), "pick");
    }
}
