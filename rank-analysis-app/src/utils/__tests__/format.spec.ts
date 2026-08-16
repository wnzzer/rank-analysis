/**
 * formatGameDate：对局时间统一按本地时区格式化
 *
 * - 数值毫秒戳字符串 / ISO 字符串 都按本地时区输出
 * - 解析不了的值原样返回
 */
import { describe, it, expect } from 'vitest'
import { formatGameDate } from '../format'

describe('formatGameDate', () => {
  it('数值毫秒戳字符串 → 本地 MM-DD HH:mm', () => {
    // 固定 UTC 时间：2024-06-05 04:13:00Z
    const raw = String(Date.UTC(2024, 5, 5, 4, 13))
    const out = formatGameDate(raw)
    const d = new Date(Number(raw))
    expect(out).toBe(
      `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    )
  })

  it('ISO 字符串 → 本地 MM-DD HH:mm（与同刻数值戳结果一致）', () => {
    const iso = '2024-06-05T04:13:00Z'
    const isoOut = formatGameDate(iso)
    const tsOut = formatGameDate(String(Date.parse(iso)))
    expect(isoOut).toBe(tsOut)
    expect(isoOut).not.toContain('2024-06-05 04:13') // 不应输出 UTC 原文
  })

  it('full 格式：完整本地时间', () => {
    const raw = '1755200000000'
    const out = formatGameDate(raw, 'full')
    expect(out).toBe(new Date(Number(raw)).toLocaleString())
  })

  it('空串返回空串', () => {
    expect(formatGameDate('')).toBe('')
  })

  it('解析不了的原样返回', () => {
    expect(formatGameDate('not-a-date')).toBe('not-a-date')
  })
})
