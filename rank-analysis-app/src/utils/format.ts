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

/**
 * 解析对局时间并格式化为**本地时区**展示（战绩卡 / 详情头 / 趋势条三处共用）。
 *
 * 对局时间来源不统一：国服/跨区有的给数值毫秒戳字符串，有的给 ISO 时间串（如
 * SGP 的 `...Z`）。若直接 `Number(raw)` 解析 ISO 会得 NaN，进而把 UTC 原文直接
 * 渲染出来——本函数统一走 `Date` 解析，输出本地时间。
 *
 * @param raw - 原始对局时间（数值毫秒戳字符串 / ISO 字符串 / 空串）
 * @param format - `short` = `MM-DD HH:mm`（战绩卡 / 详情头）；`full` = 完整本地时间（趋势条 hover）
 * @returns 本地时区格式化字符串；解析不了的原样返回
 */
export function formatGameDate(raw: string, format: 'short' | 'full' = 'short'): string {
  if (!raw) {
    return ''
  }
  const ts = Number(raw)
  const date = Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return raw
  }
  if (format === 'full') {
    return date.toLocaleString()
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
