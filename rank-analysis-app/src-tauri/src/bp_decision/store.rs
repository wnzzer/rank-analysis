//! BP 决策快照的进程内存储。
//!
//! 会话级单例：常驻求值任务每 tick 覆盖写入，命令层只读。
//!
//! 快照分三份：展示用的「当前」决策，以及 ban / pick 两条执行轨道各自的决策。
//! 后两者必须分开——ban 阶段「当前」是 ban 决策，若 pick 任务也读它就会整段
//! 空转，hover 只能等 ban 完成后才发生。
//!
//! 另外保管两项跨 tick 的状态：我们最后一次主动 hover 的英雄，以及已判定
//! 「用户接管」的 action id（按 action 作用域，阶段切换自动失效）。
//!
//! 锁毒化处理：锁内只存彼此独立的 Option 字段，无跨字段不变量。
//! 任何写入 panic 导致毒化时，取回数据继续用——快照是纯展示数据，
//! 一帧旧值不值得让功能永久失能。

use crate::bp_decision::types::BpDecision;
use std::sync::{OnceLock, PoisonError, RwLock};

#[derive(Default)]
struct StoreState {
    /// 展示用的「当前」决策——对应 `find_my_pending_action` 选中的那个动作
    decision: Option<BpDecision>,
    /// 我的 ban 动作的决策，供 ban 执行任务使用
    ban: Option<BpDecision>,
    /// 我的 pick 动作的决策，供 pick 执行任务使用。
    ///
    /// 与 `decision` 分开保存的理由：ban 阶段 `decision` 是 ban 决策，pick 任务
    /// 若也读它就会整段空转，hover 只能等 ban 完成后才发生——真机上表现为
    /// 「预选期不预选」。两条轨道各读各的，pick 的 hover 才能一开始就做。
    pick: Option<BpDecision>,
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

/// 读取当前快照。锁被毒化时取回数据继续用——快照是纯展示数据，
/// 三个字段都是独立的 Option，panic 中断最坏留下一帧旧值，不值得让功能永久失能。
pub fn read() -> Option<BpDecision> {
    store()
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .decision
        .clone()
}

/// 读取我的 ban 动作的决策（执行侧用）。
pub fn read_ban() -> Option<BpDecision> {
    store()
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .ban
        .clone()
}

/// 读取我的 pick 动作的决策（执行侧用）。ban 阶段也会有值——预选期就要 hover。
pub fn read_pick() -> Option<BpDecision> {
    store()
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .pick
        .clone()
}

/// 覆盖写入三份快照（展示用 + 两条执行轨道）。
///
/// 一次写入而非三个 setter：三者由同一个求值 tick 产出，分开写会让执行侧
/// 读到跨 tick 的混合状态。
pub fn write(decision: Option<BpDecision>, ban: Option<BpDecision>, pick: Option<BpDecision>) {
    let mut s = store().write().unwrap_or_else(PoisonError::into_inner);
    s.decision = decision;
    s.ban = ban;
    s.pick = pick;
}

pub fn last_hovered() -> Option<i32> {
    store()
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .last_hovered
}

pub fn set_last_hovered(id: Option<i32>) {
    store()
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .last_hovered = id;
}

/// 该 action 是否已判定用户接管。
pub fn is_overridden(action_id: i32) -> bool {
    store()
        .read()
        .unwrap_or_else(PoisonError::into_inner)
        .overridden_action_id
        .is_some_and(|id| id == action_id)
}

pub fn mark_overridden(action_id: i32) {
    store()
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .overridden_action_id = Some(action_id);
}

/// 离开选人期时清空全部状态。
pub fn reset() {
    *store().write().unwrap_or_else(PoisonError::into_inner) = StoreState::default();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// STORE 是进程级单例，而 cargo test 默认多线程并行：
    /// 两个测试各自 reset() 会互相擦掉对方刚写入的状态（CI 上偶现失败）。
    /// 用测试内互斥锁把触碰全局状态的测试串行化。
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn last_hovered_round_trips_and_resets() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        reset();
        assert_eq!(last_hovered(), None);
        set_last_hovered(Some(64));
        assert_eq!(last_hovered(), Some(64));
        reset();
        assert_eq!(last_hovered(), None);
    }

    #[test]
    fn override_is_scoped_to_action_id() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        reset();
        assert!(!is_overridden(10));
        mark_overridden(10);
        assert!(is_overridden(10));
        // 换到下一个 action（阶段推进）→ 标记自动失效
        assert!(!is_overridden(11));
        reset();
    }
}
