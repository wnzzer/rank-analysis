/**
 * 英雄榜的纯数据层：摊平的 OP.GG 元数据 → 表格行，以及筛选 / 排序 / 趋势
 *
 * 榜单约 400 行，全部在前端算：点列头即时重排，不用来回请求。
 *
 * @module components/champions/championTier
 */

import type { ChampionMeta } from '@renderer/services/opgg'

/** 版本趋势：上版本同分路排名与本版本之差 */
export interface Trend {
  /** up = 这版本走强（排名前移）；none = 没有上版本数据 */
  dir: 'up' | 'down' | 'flat' | 'none'
  /** 名次变化量，flat / none 为 0 */
  delta: number
}

/** 榜单一行 */
export interface TierRow {
  championId: number
  /** 英雄中文名 */
  name: string
  /** LCU 大写分路命名 TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY */
  position: string
  /** T 级 1~5，1 最强 */
  tier: number
  /** 同分路排名 */
  rank: number
  winRate: number
  pickRate: number
  banRate: number
  trend: Trend
}

/** 排序维度：default = T 级 + 同分路排名 */
export type SortKey = 'default' | 'winRate' | 'pickRate' | 'banRate'

/**
 * 算版本趋势
 * @param rank - 本版本同分路排名
 * @param rankPrevPatch - 上版本同分路排名（0 = 无数据）
 * @returns 方向与名次变化量
 */
export function trendOf(rank: number, rankPrevPatch: number): Trend {
  if (!rankPrevPatch || !rank) return { dir: 'none', delta: 0 }
  // 排名数字越小越强：上版本名次更大 = 这版本走强
  const delta = rankPrevPatch - rank
  if (delta === 0) return { dir: 'flat', delta: 0 }
  return { dir: delta > 0 ? 'up' : 'down', delta: Math.abs(delta) }
}

/**
 * 摊平的元数据 → 表格行
 * @param metas - `list_champion_metas` 的结果（英雄 × 分路各一条）
 * @param position - LCU 大写分路。榜单永远是单路：T 级与 rank 都是分路内口径，
 *   跨分路混排无论怎么排都不可比（v2 据此去掉了「全部分路」）
 * @param nameOf - 英雄 ID → 中文名
 * @returns 表格行，顺序保持入参顺序（排序另行调用 sortRows）
 */
export function toRows(
  metas: ChampionMeta[],
  position: string,
  nameOf: (championId: number) => string
): TierRow[] {
  return metas
    .filter(m => m.position === position)
    .map(m => ({
      championId: m.championId,
      name: nameOf(m.championId),
      position: m.position,
      tier: m.tier,
      rank: m.rank,
      winRate: m.winRate,
      pickRate: m.pickRate,
      banRate: m.banRate,
      trend: trendOf(m.rank, m.rankPrevPatch)
    }))
}

/** 名次挪动到多少才值得在榜上标出来：小于它的是版本噪音 */
export const TREND_MIN_DELTA = 10

/**
 * 只留下值得标注的趋势
 *
 * 榜上每行都挂一个 ↑/↓ 会把右边缘变成一串红绿箭头，而多数英雄的名次变化只是抖动。
 * @param trend - `trendOf` 的结果
 * @returns 挪动达到 {@link TREND_MIN_DELTA} 时原样返回，否则 null（持平 / 无上版本数据同样返回 null）
 */
export function notableTrend(trend: Trend): Trend | null {
  if (trend.dir !== 'up' && trend.dir !== 'down') return null
  return trend.delta >= TREND_MIN_DELTA ? trend : null
}

/**
 * 按关键词过滤（英雄名 / 称号 / 别名）
 * @param rows - 表格行
 * @param keyword - 搜索词，空白视为不过滤
 * @param textsOf - 英雄 ID → 可搜索文本（名字 / 称号 / 别名）
 */
export function filterRows(
  rows: TierRow[],
  keyword: string,
  textsOf: (championId: number) => string[]
): TierRow[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return rows
  return rows.filter(r =>
    [r.name, ...textsOf(r.championId)].some(t => t && t.toLowerCase().includes(kw))
  )
}

/**
 * 排序（不改动入参数组）
 * @param rows - 表格行
 * @param key - 排序维度
 * @param desc - 是否降序（default 维度恒按「T 级升序 + 排名升序」，desc 无效）
 */
export function sortRows(rows: TierRow[], key: SortKey, desc: boolean): TierRow[] {
  const next = [...rows]
  if (key === 'default') {
    return next.sort((a, b) => a.tier - b.tier || a.rank - b.rank)
  }
  const sign = desc ? -1 : 1
  return next.sort((a, b) => (a[key] - b[key]) * sign)
}
