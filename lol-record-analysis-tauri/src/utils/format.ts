/**
 * 纯展示格式化函数：数字、百分比等
 */

export function dotFillCount(rate: number | undefined): number {
  return Math.min(5, Math.max(0, Math.round((((rate ?? 0) as number) / 100) * 5)))
}

export function safeRelativePercent(value: number, maxValue: number) {
  if (maxValue <= 0 || value <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((value / maxValue) * 100)))
}

export function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '--'
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}m`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2).replace(/\.0$/, '')}k`
  }
  return `${value}`
}
