/**
 * 决策回测前端封装（M2 数据飞轮：建议 → 回测 → 采纳/未采纳对账）。
 *
 * 纪律：对账与回测全是 Rust 侧确定性计算，前端只 invoke 与展示。
 * `fetchDecisionBacktest(gameId)` 幂等（ledger upsert + 建议消费一次），
 * 详情页可安全重复调用；失败统一返回 null 供静默降级。
 */

import { invoke } from '@tauri-apps/api/core'

/** 回测结果（与 Rust `BacktestResult` 对齐） */
export interface BacktestResult {
  suggestionChampionId: number
  actualChampionId: number
  matchupDelta: number
  winRateGap: number
  scoreGap: number
  confidence: number
  caveats: string[]
  insufficientData: boolean
}

/** 对账 + 回测一体结果（与 Rust `DecisionBacktest` 对齐） */
export interface DecisionBacktest {
  aligned: boolean
  reason:
    | 'ok'
    | 'no_pending_suggestion'
    | 'my_puuid_missing'
    | 'not_in_game'
    | 'parse_game_time_failed'
    | 'position_unknown'
    | (string & {})
  suggestedAtMs?: number | null
  suggestionChampionId?: number | null
  actualChampionId?: number | null
  enemyChampionId?: number | null
  position?: string | null
  adopted?: boolean | null
  resultWin?: boolean | null
  backtest?: BacktestResult | null
}

/** 采纳 vs 未采纳统计（与 Rust `AdoptionStats` 对齐） */
export interface AdoptionStats {
  adoptedTotal: number
  notAdoptedTotal: number
  adoptedWinRate: number | null
  notAdoptedWinRate: number | null
}

/** 赛后决策对账（失败返回 null 供静默降级；重复调用幂等） */
export async function fetchDecisionBacktest(gameId: number): Promise<DecisionBacktest | null> {
  try {
    return await invoke<DecisionBacktest>('get_decision_backtest', { gameId })
  } catch (err) {
    console.warn('[backtest] get_decision_backtest failed', err)
    return null
  }
}

/** 采纳/未采纳统计（失败返回 null） */
export async function fetchAdoptionStats(): Promise<AdoptionStats | null> {
  try {
    return await invoke<AdoptionStats>('get_adoption_stats')
  } catch (err) {
    console.warn('[backtest] get_adoption_stats failed', err)
    return null
  }
}

/** 未对齐原因的中文说明（前端展示用） */
export function reasonLabel(reason: DecisionBacktest['reason']): string {
  switch (reason) {
    case 'ok':
      return '已对账'
    case 'no_pending_suggestion':
      return '本局无赛前建议'
    case 'my_puuid_missing':
      return '本机玩家信息不可用'
    case 'not_in_game':
      return '本机玩家不在该局'
    case 'parse_game_time_failed':
      return '对局时间解析失败'
    case 'position_unknown':
      return '分路信息缺失'
    default:
      return reason
  }
}

/** 回测结果的中文概览（数据不足时如实说明，不夸大） */
export function backtestSummary(r: BacktestResult): string {
  if (r.insufficientData) return '样本不足，暂不作判断'
  const sign = r.matchupDelta > 0.01 ? '高于' : r.matchupDelta < -0.01 ? '低于' : '持平'
  return `建议英雄历史表现${sign}实际英雄`
}
