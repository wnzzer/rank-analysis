/**
 * 选人期 BP 决策快照类型，与 src-tauri/src/bp_decision/types.rs 同构。
 *
 * 序列化规范（来自 Rust serde 派生，与 types/rules.ts 同一套约定）：
 * - 结构体无 rename_all，字段名保持 snake_case
 * - BpOrigin / BpRejected: #[serde(tag = "type")]，变体名保持 PascalCase
 * - BpActionType / BpMode: 单元变体，序列化为 "Pick" / "Ban" / "Auto" / "Advisory"
 */

export type BpActionType = 'Ban' | 'Pick'

/** Auto = 到点会真的执行；Advisory = 自动化未开，同一套计算但只供展示 */
export type BpMode = 'Auto' | 'Advisory'

export type BpOrigin =
  | { type: 'Rule'; rule_id: string; rule_name: string }
  | { type: 'Fallback'; pool_size: number }

/**
 * 目标英雄的对位数据支撑。
 *
 * OP.GG 只给「最难打的 top3 对手」，因此这里记录的是目标面对当前敌方阵容时
 * **最差的一条对位**，`win_rate` 通常 <0.5。它出现 = 「这个选择有已知风险，
 * 但池内/规则内没有更好的」；不出现 = 「与当前阵容没有已知的被克制关系」。
 */
export interface BpEvidence {
  win_rate: number
  against_champion_id: number
}

export interface BpTarget {
  champion_id: number
  /** 执行时是否锁定。ban 恒 true；pick 取规则的 lock，兜底为 true */
  lock: boolean
  origin: BpOrigin
  evidence: BpEvidence | null
}

export type BpRejected =
  | { type: 'Banned'; champion_id: number }
  | { type: 'Taken'; champion_id: number; by_ally: boolean }
  | { type: 'CounteredBy'; champion_id: number; opponent_id: number; subject_win_rate: number }
  | { type: 'RuleNotMatched'; rule_id: string; rule_name: string }

export interface BpDecision {
  action_type: BpActionType
  /** null = 无可执行目标 */
  target: BpTarget | null
  rejected: BpRejected[]
  mode: BpMode
  time_left_secs: number
  execute_at_secs_left: number
  user_overridden: boolean
}
