/**
 * ParsedMatchQuery 的构造与防御性校验
 *
 * 模型输出不可信:字段可能缺失、类型可能错、英雄/队列 id 可能编造。
 * 校验策略是「宁可少筛不误筛」——非法字段降级为空/any,绝不抛错,
 * 保证下游筛选永远拿到结构完整的查询对象。
 */

import type { ParsedMatchQuery } from './types'

/** 全空查询:不筛任何维度 */
export function emptyQuery(): ParsedMatchQuery {
  return {
    timeRange: { from: null, to: null },
    selfChampionIds: [],
    allyChampionIds: [],
    enemyChampionIds: [],
    myTeamChampionIds: [],
    result: 'any',
    queueIds: [],
    playerNames: [],
    intent: 'list'
  }
}

/** 提取数字数组并按白名单过滤(去重、丢弃非数字与清单外 id) */
function idArray(raw: unknown, valid: Set<number>): number[] {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const v of raw) {
    if (typeof v === 'number' && Number.isFinite(v) && valid.has(v) && !out.includes(v)) {
      out.push(v)
    }
  }
  return out
}

/**
 * 校验并规范化为纯日期 YYYY-MM-DD,非法返回 null。
 * 模型可能输出带时间的完整 ISO 串,必须截断——下游会再拼 `T00:00:00.000Z`,
 * 原样透传会产生 NaN 日期使时间窗静默失效。
 */
function isoDateOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return Number.isNaN(new Date(`${s}T00:00:00.000Z`).getTime()) ? null : s
}

/**
 * 把模型原始 JSON 输出净化为合法的 ParsedMatchQuery
 * @param raw - 模型输出(任意形状)
 * @param validChampionIds - 合法英雄 id 白名单(来自 get_champion_options)
 * @param validQueueIds - 合法队列 id 白名单(来自 get_game_modes)
 */
export function validateParsedQuery(
  raw: unknown,
  validChampionIds: Set<number>,
  validQueueIds: Set<number>
): ParsedMatchQuery {
  const q = emptyQuery()
  if (typeof raw !== 'object' || raw === null) return q
  const r = raw as Record<string, unknown>

  const tr = (typeof r.timeRange === 'object' && r.timeRange) || {}
  let from = isoDateOrNull((tr as Record<string, unknown>).from)
  let to = isoDateOrNull((tr as Record<string, unknown>).to)
  // from > to 说明模型日期算错了,整个时间窗作废比错误截断更安全
  if (from && to && from > to) {
    from = null
    to = null
  }
  q.timeRange = { from, to }

  q.selfChampionIds = idArray(r.selfChampionIds, validChampionIds)
  q.allyChampionIds = idArray(r.allyChampionIds, validChampionIds)
  q.enemyChampionIds = idArray(r.enemyChampionIds, validChampionIds)
  q.myTeamChampionIds = idArray(r.myTeamChampionIds, validChampionIds)
  q.queueIds = idArray(r.queueIds, validQueueIds)

  if (r.result === 'win' || r.result === 'loss') q.result = r.result

  if (Array.isArray(r.playerNames)) {
    const names: string[] = []
    for (const v of r.playerNames) {
      if (typeof v !== 'string') continue
      const name = v.trim()
      if (name && !names.includes(name)) names.push(name)
    }
    q.playerNames = names
  }

  if (r.intent === 'count_encounters') q.intent = 'count_encounters'

  return q
}
