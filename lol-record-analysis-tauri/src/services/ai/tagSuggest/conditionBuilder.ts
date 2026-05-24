/**
 * 把 Stage 1 的 Candidate 翻译成 TagCondition（前端拼接，AI 不参与）。
 *
 * 由于规则 100% 由模板拼接，永远不会出现 schema 错误。
 *
 * 模板：
 *   - 数值型 metric → history + (queue 可选) + stat filter + count refresh
 *   - streak metric → history + (queue 可选) + streak refresh（无 stat filter）
 */

import type {
  TagCondition,
  MatchFilter,
  MatchRefresh,
  Operator
} from '@renderer/types/tagSuggest'
import type { Candidate } from './types'

function buildQueueFilter(queueIds: number[]): MatchFilter | null {
  if (queueIds.length === 0) return null
  return { type: 'queue', ids: queueIds }
}

export function buildCondition(c: Candidate): TagCondition {
  const queueFilter = buildQueueFilter(c.queueIds)

  if (c.metric === 'streak') {
    // streak: direction 必须是 'win' | 'loss'
    const kind = c.direction === 'win' ? 'win' : 'loss'
    const refresh: MatchRefresh = {
      type: 'streak',
      min: c.countMin,
      kind
    }
    return {
      type: 'history',
      filters: queueFilter ? [queueFilter] : [],
      refresh
    }
  }

  // 数值型 metric: direction 必须是 Operator
  const op = c.direction as Operator
  const statFilter: MatchFilter = {
    type: 'stat',
    metric: c.metric,
    op,
    value: c.threshold
  }
  const refresh: MatchRefresh = {
    type: 'count',
    op: '>=',
    value: c.countMin
  }
  return {
    type: 'history',
    filters: queueFilter ? [queueFilter, statFilter] : [statFilter],
    refresh
  }
}
