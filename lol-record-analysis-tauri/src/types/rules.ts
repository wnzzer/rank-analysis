/**
 * Pick/Ban 规则引擎前端类型，与 src-tauri/src/command/rule_config.rs 同构。
 *
 * 序列化规范（来自 Rust serde 派生）：
 * - RuleCondition: #[serde(tag = "type")] 且无 rename_all，变体名保持 PascalCase
 * - Position 枚举值: #[serde(rename_all = "lowercase")]，例如 "top" / "jungle"
 * - PickAction / BanAction: 无 rename_all，字段名保持 snake_case，例如 champion_id
 * - PickBanRule: 字段 id / name / enabled / conditions / action 本身已是小写，无变化
 */

export type Position = 'top' | 'jungle' | 'middle' | 'bottom' | 'utility'

export type RuleCondition =
  | { type: 'Position'; value: Position }
  | { type: 'AllyChampionsContains'; ids: number[] }
  | { type: 'AllyChampionsNotContains'; ids: number[] }
  | { type: 'EnemyChampionsContains'; ids: number[] }
  | { type: 'EnemyChampionsNotContains'; ids: number[] }

/** 对应 Rust `PickAction`，字段 champion_id 保持 snake_case */
export interface PickAction {
  champion_id: number
  lock: boolean
}

/** 对应 Rust `BanAction`，字段 champion_id 保持 snake_case */
export interface BanAction {
  champion_id: number
}

/** 对应 Rust `PickBanRule<A>` */
export interface PickBanRule<A> {
  id: string
  name: string
  enabled: boolean
  conditions: RuleCondition[]
  action: A
}

export type PickRule = PickBanRule<PickAction>
export type BanRule = PickBanRule<BanAction>

export const POSITION_LABEL: Record<Position, string> = {
  top: '上路',
  jungle: '打野',
  middle: '中路',
  bottom: '下路',
  utility: '辅助'
}

export const CONDITION_TYPE_LABEL: Record<RuleCondition['type'], string> = {
  Position: '我的位置 =',
  AllyChampionsContains: '自家英雄包含',
  AllyChampionsNotContains: '自家英雄不包含',
  EnemyChampionsContains: '对面英雄包含',
  EnemyChampionsNotContains: '对面英雄不包含'
}
