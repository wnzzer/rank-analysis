/**
 * BP 智能推荐相关类型，与 Rust schema (src-tauri/src/command/bp_suggest.rs)
 * 严格同构（snake_case，与 bpDecision.ts 同约定）。
 */

/** 候选去向池 */
export type SuggestedPool = 'pick' | 'ban'

/** 单条候选的依据（后端 None 字段被省略） */
export interface BpSuggestEvidence {
  games?: number
  win_rate?: number // 0~1
  losses_against?: number
  loss_games?: number
  opgg_tier?: number
  opgg_win_rate?: number // 0~1
  position?: string // 大写 TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY
}

/** 单条推荐候选 */
export interface BpSuggestItem {
  champion_id: number
  suggested_pool: SuggestedPool
  already_in_pool: boolean
  evidence: BpSuggestEvidence
}

/** 推荐结果（三分区） */
export interface BpSuggestResult {
  main_position: string
  sample_games: number
  opgg_ok: boolean
  frequent: BpSuggestItem[]
  nemesis: BpSuggestItem[]
  hot_t0: BpSuggestItem[]
}
