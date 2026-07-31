//! BP 决策快照的进程内存储。
//!
//! 会话级单例：常驻求值任务每 tick 覆盖写入，命令层只读。
//! 同时保管两项跨 tick 的状态：我们最后一次主动 hover 的英雄、
//! 以及已判定「用户接管」的 action id（按 action 作用域，阶段切换自动失效）。

use crate::bp_decision::types::BpDecision;
use std::sync::{OnceLock, RwLock};

#[derive(Default)]
struct StoreState {
    decision: Option<BpDecision>,
    /// 我们最后一次主动 hover 的英雄 ID
    last_hovered: Option<i32>,
    /// 已判定接管的 action id。每个 ban/pick action 的 id 唯一，
    /// 因此阶段推进后旧标记自然失效，无需显式清理。
    overridden_action_id: Option<i32>,
}

static STORE: OnceLock<RwLock<StoreState>> = OnceLock::new();

fn store() -> &'static RwLock<StoreState> {
    STORE.get_or_init(|| RwLock::new(StoreState::default()))
}

/// 读取当前快照。锁被毒化时返回 None——展示型数据，不值得 panic。
pub fn read() -> Option<BpDecision> {
    store().read().ok()?.decision.clone()
}

/// 覆盖写入快照。
pub fn write(decision: Option<BpDecision>) {
    if let Ok(mut s) = store().write() {
        s.decision = decision;
    }
}

pub fn last_hovered() -> Option<i32> {
    store().read().ok()?.last_hovered
}

pub fn set_last_hovered(id: Option<i32>) {
    if let Ok(mut s) = store().write() {
        s.last_hovered = id;
    }
}

/// 该 action 是否已判定用户接管。
pub fn is_overridden(action_id: i32) -> bool {
    store()
        .read()
        .ok()
        .and_then(|s| s.overridden_action_id)
        .is_some_and(|id| id == action_id)
}

pub fn mark_overridden(action_id: i32) {
    if let Ok(mut s) = store().write() {
        s.overridden_action_id = Some(action_id);
    }
}

/// 离开选人期时清空全部状态。
pub fn reset() {
    if let Ok(mut s) = store().write() {
        *s = StoreState::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_hovered_round_trips_and_resets() {
        reset();
        assert_eq!(last_hovered(), None);
        set_last_hovered(Some(64));
        assert_eq!(last_hovered(), Some(64));
        reset();
        assert_eq!(last_hovered(), None);
    }

    #[test]
    fn override_is_scoped_to_action_id() {
        reset();
        assert!(!is_overridden(10));
        mark_overridden(10);
        assert!(is_overridden(10));
        // 换到下一个 action（阶段推进）→ 标记自动失效
        assert!(!is_overridden(11));
        reset();
    }
}
