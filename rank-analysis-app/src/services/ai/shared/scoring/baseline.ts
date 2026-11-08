/**
 * 国服大盘基准库：类型、格子键与带回退的查询。
 *
 * 键格式 `<queue>|<position>|<championId>`，`*` 表示汇总格；英雄格 n < 50 不收录，
 * 单个指标样本 < 50 也不收录（时间线指标样本远少于终局指标），查询时逐指标回退：
 * 英雄格 → 位置格 → 队列格。无分路模式（大乱斗/海斗）position 恒为 `*`。
 */
import type { MetricName } from './metrics'

/** 单指标统计（总体标准差） */
export interface MetricStats {
  mean: number
  std: number
}

/** 一个格子：样本局数 + 各指标统计 */
export interface CellStats {
  n: number
  metrics: Partial<Record<MetricName, MetricStats>>
}

/**
 * 构建元信息（不含个人数据）
 * @property versions - 语料覆盖的大版本（如 16.14）
 * @property note - 采样偏差说明
 */
export interface BaselineMeta {
  builtAt: string
  versions: string[]
  sampleGames: number
  detailsGames: number
  perQueue: Record<string, number>
  note: string
}

export interface Baseline {
  meta: BaselineMeta
  cells: Record<string, CellStats>
}

/** 格子 / 指标的最少样本数 */
export const MIN_CELL_SAMPLES = 50

/** 有对线意义的分路 */
export const LANE_POSITIONS: ReadonlySet<string> = new Set([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'UTILITY'
])

/** 队列 → 基准队列：匹配征召/自选/快速与单双排同形，借用 420 */
const QUEUE_ALIAS: Record<number, number> = {
  420: 420,
  440: 440,
  400: 420,
  430: 420,
  490: 420,
  450: 450,
  2400: 2400
}

/** 基准队列；无可用基准的队列（斗魂竞技场等）为 null */
export function baselineQueue(queueId: number): number | null {
  return QUEUE_ALIAS[queueId] ?? null
}

/** 位置键：无分路或位置未知时为 `*` */
export function positionKey(position: string, hasLanes: boolean): string {
  return hasLanes && LANE_POSITIONS.has(position) ? position : '*'
}

/** 格子键 */
export function cellKey(queue: number, position: string, champion: number | '*'): string {
  return `${queue}|${position}|${champion}`
}

/**
 * 查某玩家某指标的基准统计（逐指标回退）。
 * @returns 三级都没有时为 null（调用方改用本局相对比较）
 */
export function lookupStats(
  b: Baseline,
  queueId: number,
  position: string,
  championId: number,
  hasLanes: boolean,
  metric: MetricName
): MetricStats | null {
  const q = baselineQueue(queueId)
  if (q === null) return null
  const pos = positionKey(position, hasLanes)
  const keys = new Set([cellKey(q, pos, championId), cellKey(q, pos, '*'), cellKey(q, '*', '*')])
  for (const k of keys) {
    const m = b.cells[k]?.metrics[metric]
    if (m) return m
  }
  return null
}
