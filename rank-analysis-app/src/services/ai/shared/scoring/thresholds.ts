/**
 * 分位数阈值：同「队列 × 位置 × 是否有时间线」的语料总分/分项分的十分位（P10..P90）。
 *
 * 有/无时间线分开统计：有时间线时多了对线分项、死亡质量口径也不同，分布不可混用。
 * 查询回退：q|pos|模式 → q|*|模式 → q|pos|notl → q|*|notl → *|*|模式 → *|*|notl → 默认。
 */
import { baselineQueue, positionKey } from './baseline'

/** 十分位：下标 0..8 对应 P10..P90 */
export type Deciles = number[]

export interface ThresholdCell {
  n: number
  total: Deciles
  /** 键为分项名（SubScoreKey） */
  sub: Partial<Record<string, Deciles>>
}

export interface Thresholds {
  meta: { builtAt: string; sampleGames: number }
  cells: Record<string, ThresholdCell>
}

/** 阈值库为空时的兜底（取自 2 万局终局口径原型的量级） */
export const DEFAULT_THRESHOLD: ThresholdCell = {
  n: 0,
  total: [-0.8, -0.55, -0.35, -0.15, 0, 0.15, 0.3, 0.55, 0.85],
  sub: {}
}

/** 阈值键 */
export function thresholdKey(queue: number | '*', position: string, withTimeline: boolean): string {
  return `${queue}|${position}|${withTimeline ? 'tl' : 'notl'}`
}

/** 按回退顺序查阈值格 */
export function lookupThresholds(
  th: Thresholds,
  queueId: number,
  position: string,
  hasLanes: boolean,
  withTimeline: boolean
): ThresholdCell {
  const q = baselineQueue(queueId)
  const pos = positionKey(position, hasLanes)
  const keys =
    q === null
      ? []
      : [
          thresholdKey(q, pos, withTimeline),
          thresholdKey(q, '*', withTimeline),
          thresholdKey(q, pos, false),
          thresholdKey(q, '*', false)
        ]
  keys.push(thresholdKey('*', '*', withTimeline), thresholdKey('*', '*', false))
  for (const k of keys) {
    const c = th.cells[k]
    if (c) return c
  }
  return DEFAULT_THRESHOLD
}

/** 取第 p 百分位（p ∈ 10..90） */
export function decileAt(d: Deciles, p: 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90): number {
  return d[p / 10 - 1]
}

/** 分档文字：如 'P60~P70'、'低于 P10'、'高于 P90' */
export function percentileBand(value: number, d: Deciles): string {
  const k = d.filter(x => x <= value).length
  if (k === 0) return '低于 P10'
  if (k >= 9) return '高于 P90'
  return `P${k * 10}~P${k * 10 + 10}`
}

/** 已升序数组的线性插值分位数（q ∈ [0,1]） */
export function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN
  const idx = q * (sortedAsc.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

/** 十分位 P10..P90 */
export function deciles(values: number[]): Deciles {
  const sorted = [...values].sort((a, b) => a - b)
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => percentile(sorted, i / 10))
}
