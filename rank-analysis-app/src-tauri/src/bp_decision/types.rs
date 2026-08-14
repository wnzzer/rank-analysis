//! BP 决策快照的数据类型。
//!
//! 序列化约定：不加 `rename_all`，字段保持 snake_case；tagged enum 用
//! `#[serde(tag = "type")]`。与 `command/rule_config.rs` ↔ `src/types/rules.ts`
//! 的既有约定一致，前端 `src/types/bpDecision.ts` 与本文件同构。

use serde::{Deserialize, Serialize};

/// 本次决策针对的动作类型。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BpActionType {
    Ban,
    Pick,
}

/// 决策的执行模式。
///
/// - `Auto`: 对应自动化开关已开，到点会真的执行
/// - `Advisory`: 开关未开，同一套计算但只供展示
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BpMode {
    Auto,
    Advisory,
}

/// 英雄不可用的原因。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unavailable {
    /// 已被任何一方 ban 掉（completed）
    Banned,
    /// 已被其他格子的玩家 hover / pick；`by_ally` 区分我方还是对面
    Taken { by_ally: bool },
}

/// 当前用户尚未完成的那个 BP 动作。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MyPendingAction {
    /// LCU action id，PATCH 时使用
    pub action_id: i32,
    pub action_type: BpActionType,
    /// 是否轮到我了（`is_in_progress`）
    pub is_in_progress: bool,
    /// 当前已 hover 的英雄 ID，0 = 未 hover
    pub champion_id: i32,
}

/// 决策从哪条路来的。
///
/// 与 [`BpEvidence`] 必须分开：同一条路径可以有也可以没有数据支撑。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type")]
pub enum BpOrigin {
    /// 命中了用户配置的某条规则
    Rule { rule_id: String, rule_name: String },
    /// 没有规则命中，走的兜底池
    Fallback { pool_size: usize },
}

/// 目标英雄的对位数据支撑。
///
/// 注意语义：OP.GG 只给「最难打的 top3 对手」，因此本字段记录的是
/// **目标英雄面对当前敌方阵容时最差的一条对位**，`win_rate` 通常 <0.5。
/// 它出现 = 「这个选择有已知风险，但池内/规则内没有更好的」，
/// 不出现 = 「与当前敌方阵容没有已知的被克制关系」。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct BpEvidence {
    /// 目标英雄对 `against_champion_id` 的对线胜率（0~1）
    pub win_rate: f64,
    /// 造成该劣势的敌方英雄 ID
    pub against_champion_id: i32,
}

/// 决策选中的目标。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BpTarget {
    pub champion_id: i32,
    /// 执行时是否锁定。ban 恒为 true；pick 取规则的 `lock`，兜底为 true
    pub lock: bool,
    pub origin: BpOrigin,
    pub evidence: Option<BpEvidence>,
}

/// 落选候选及原因。
///
/// 「为什么不是别的」比「为什么是它」更能建立信任——这一组是必须项，
/// 它证明引擎真的比较过候选，而不是随手抓了一个。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type")]
pub enum BpRejected {
    /// 已被 ban
    Banned { champion_id: i32 },
    /// 已被他人 hover / pick
    Taken { champion_id: i32, by_ally: bool },
    /// 被当前敌方阵容中的某英雄克制（避雷排除）
    CounteredBy {
        champion_id: i32,
        opponent_id: i32,
        subject_win_rate: f64,
    },
    /// 规则条件未满足
    RuleNotMatched { rule_id: String, rule_name: String },
}

/// 一次 BP 规则求值的完整可解释结果。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BpDecision {
    pub action_type: BpActionType,
    /// None = 无可执行目标
    pub target: Option<BpTarget>,
    pub rejected: Vec<BpRejected>,
    pub mode: BpMode,
    /// 快照生成时的剩余秒数
    pub time_left_secs: f64,
    /// 降到该值时执行
    pub execute_at_secs_left: f64,
    /// 用户已接管，本阶段不再自动执行
    pub user_overridden: bool,
    /// 是否真的轮到我了。
    ///
    /// 决策快照在**还没轮到我时也会产生**（预选期要提前 hover，见
    /// `evaluate::find_my_pending_action`），而执行只在轮到我时发生。
    /// 前端必须据此区分，否则会在别人的回合里显示「Xs 后自动执行」
    /// 这种不会兑现的承诺。
    pub is_in_progress: bool,
}
