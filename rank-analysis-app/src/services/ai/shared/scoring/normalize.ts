/**
 * z 归一化：z = (value − mean) / max(std, 1e-6)，截断到 [−3, 3]。
 * 基准缺失时用本局 10 人的相对统计兜底（spec：样本不足时仅用本局相对比较）。
 */
import type { MetricStats } from './baseline'

export const Z_CLAMP = 3
export const STD_FLOOR = 1e-6

/**
 * @returns value 或 stats 缺失时为 null
 */
export function zScore(value: number | null | undefined, stats: MetricStats | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !stats) return null
  const z = (value - stats.mean) / Math.max(stats.std, STD_FLOOR)
  return Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z))
}

/**
 * 本局相对统计（总体标准差）。
 * @returns 有效值少于 2 个时为 null
 */
export function localStats(values: Array<number | null | undefined>): MetricStats | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  if (v.length < 2) return null
  const mean = v.reduce((s, x) => s + x, 0) / v.length
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length
  return { mean, std: Math.sqrt(variance) }
}
