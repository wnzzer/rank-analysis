/**
 * 基准累加：按格子键累计每个指标的样本数、和、平方和，最后算均值与总体标准差。
 */
import type { CellStats } from '../../src/services/ai/shared/scoring/baseline'
import type { MetricName } from '../../src/services/ai/shared/scoring/metrics'

interface Moments {
  n: number
  sum: number
  sumSq: number
}

/** 格子键 → { 样本数, 指标 → 矩 } */
export type Accumulator = Map<string, { n: number; metrics: Map<string, Moments> }>

/** 把一个玩家样本计入若干格子（null/非有限值不计入该指标） */
export function addSample(
  acc: Accumulator,
  keys: string[],
  values: Partial<Record<string, number | null>>
): void {
  for (const key of keys) {
    const cell = acc.get(key) ?? { n: 0, metrics: new Map<string, Moments>() }
    cell.n++
    for (const [m, v] of Object.entries(values)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      const mo = cell.metrics.get(m) ?? { n: 0, sum: 0, sumSq: 0 }
      mo.n++
      mo.sum += v
      mo.sumSq += v * v
      cell.metrics.set(m, mo)
    }
    acc.set(key, cell)
  }
}

const r4 = (x: number): number => Number(x.toFixed(4))

/**
 * 产出格子统计：样本数 < minN 的格子与指标都不收录。
 */
export function finalizeCells(acc: Accumulator, minN: number): Record<string, CellStats> {
  const out: Record<string, CellStats> = {}
  for (const [key, cell] of acc) {
    if (cell.n < minN) continue
    const metrics: CellStats['metrics'] = {}
    for (const [m, mo] of cell.metrics) {
      if (mo.n < minN) continue
      const mean = mo.sum / mo.n
      const std = Math.sqrt(Math.max(0, mo.sumSq / mo.n - mean * mean))
      metrics[m as MetricName] = { mean: r4(mean), std: r4(std) }
    }
    out[key] = { n: cell.n, metrics }
  }
  return out
}

/** Pearson 相关；任一侧方差为 0 时返回 0 */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const mx = xs.slice(0, n).reduce((s, x) => s + x, 0) / n
  const my = ys.slice(0, n).reduce((s, y) => s + y, 0) / n
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my)
    vx += (xs[i] - mx) ** 2
    vy += (ys[i] - my) ** 2
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0
}
