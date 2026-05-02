/**
 * AI 标签建议相关的 TypeScript 类型，与 Rust schema
 * (src-tauri/src/command/user_tag_config.rs) 严格同构。
 *
 * Operator 序列化为字符串符号（"<", ">=" 等），不是枚举名。
 */

export type Operator = '>' | '>=' | '<' | '<=' | '==' | '!='
export type StreakType = 'win' | 'loss'

export type MatchFilter =
  | { type: 'queue'; ids: number[] }
  | { type: 'champion'; ids: number[] }
  | { type: 'stat'; metric: string; op: Operator; value: number }

export type MatchRefresh =
  | { type: 'count'; op: Operator; value: number }
  | { type: 'average'; metric: string; op: Operator; value: number }
  | { type: 'sum'; metric: string; op: Operator; value: number }
  | { type: 'max'; metric: string; op: Operator; value: number }
  | { type: 'min'; metric: string; op: Operator; value: number }
  | { type: 'streak'; min: number; kind: StreakType }

export type TagCondition =
  | { type: 'and'; conditions: TagCondition[] }
  | { type: 'or'; conditions: TagCondition[] }
  | { type: 'not'; condition: TagCondition }
  | { type: 'history'; filters: MatchFilter[]; refresh: MatchRefresh }
  | { type: 'currentQueue'; ids: number[] }
  | { type: 'currentChampion'; ids: number[] }

export interface TagConfig {
  id: string
  name: string
  desc: string
  good: boolean
  enabled: boolean
  condition: TagCondition
  isDefault: boolean
}

/** AI 输出的单条候选（采用前/后），叠加 adopted 状态用于 UI 灰态。 */
export type TagSuggestion = TagConfig & { adopted?: boolean }

export interface TagSuggestResult {
  good: TagSuggestion[]
  bad: TagSuggestion[]
  droppedCount: number
  generatedAt: string // ISO timestamp
}
