/**
 * useDateFormat composable 单元测试
 * @module composables/useDateFormat
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatMatchDate,
  formatDateTime,
  formatRelativeTime,
  formatGameDuration
} from './useDateFormat'

describe('useDateFormat', () => {
  describe('formatMatchDate', () => {
    /**
     * 测试：当传入有效时间戳时应返回正确的月/日格式
     */
    it('should return correct M/D format when given valid timestamp', () => {
      // 2024年3月15日
      const timestamp = new Date(2024, 2, 15).getTime()
      const result = formatMatchDate(timestamp)
      expect(result).toBe('3/15')
    })

    /**
     * 测试：当传入1月1日时应返回正确的格式
     */
    it('should return correct format for January 1st', () => {
      const timestamp = new Date(2024, 0, 1).getTime()
      const result = formatMatchDate(timestamp)
      expect(result).toBe('1/01')
    })

    /**
     * 测试：当传入12月31日时应返回正确的格式
     */
    it('should return correct format for December 31st', () => {
      const timestamp = new Date(2024, 11, 31).getTime()
      const result = formatMatchDate(timestamp)
      expect(result).toBe('12/31')
    })

    /**
     * 测试：当传入个位数日期时应补零
     */
    it('should pad single digit day with zero', () => {
      const timestamp = new Date(2024, 5, 5).getTime()
      const result = formatMatchDate(timestamp)
      expect(result).toBe('6/05')
    })

    /**
     * 测试：当传入时间戳为0时应返回1970年1月1日
     */
    it('should return epoch date when timestamp is zero', () => {
      const result = formatMatchDate(0)
      expect(result).toBe('1/01')
    })

    /**
     * 测试：当传入负数时间戳时应正确处理
     */
    it('should handle negative timestamp correctly', () => {
      // 1969年12月31日
      const timestamp = -86400000
      const result = formatMatchDate(timestamp)
      expect(result).toBe('12/31')
    })
  })

  describe('formatDateTime', () => {
    /**
     * 测试：当传入有效时间戳时应返回正确的日期时间格式
     */
    it('should return correct YYYY-MM-DD HH:mm format when given valid timestamp', () => {
      // 2024年3月15日 14:30:00
      const timestamp = new Date(2024, 2, 15, 14, 30, 0).getTime()
      const result = formatDateTime(timestamp)
      expect(result).toBe('2024-03-15 14:30')
    })

    /**
     * 测试：当传入午夜时间时应正确处理
     */
    it('should handle midnight time correctly', () => {
      const timestamp = new Date(2024, 0, 1, 0, 0, 0).getTime()
      const result = formatDateTime(timestamp)
      expect(result).toBe('2024-01-01 00:00')
    })

    /**
     * 测试：当传入23:59时应正确处理
     */
    it('should handle 23:59 time correctly', () => {
      const timestamp = new Date(2024, 0, 1, 23, 59, 0).getTime()
      const result = formatDateTime(timestamp)
      expect(result).toBe('2024-01-01 23:59')
    })

    /**
     * 测试：当传入个位数月日时应补零
     */
    it('should pad single digit month and day with zero', () => {
      const timestamp = new Date(2024, 0, 5, 9, 5, 0).getTime()
      const result = formatDateTime(timestamp)
      expect(result).toBe('2024-01-05 09:05')
    })

    /**
     * 测试：当传入时间戳为0时应返回epoch时间
     */
    it('should return epoch datetime when timestamp is zero', () => {
      // 注意：时区可能影响结果，这里使用本地时区
      const result = formatDateTime(0)
      const expectedDate = new Date(0)
      const year = expectedDate.getFullYear()
      const month = (expectedDate.getMonth() + 1).toString().padStart(2, '0')
      const day = expectedDate.getDate().toString().padStart(2, '0')
      const hours = expectedDate.getHours().toString().padStart(2, '0')
      const minutes = expectedDate.getMinutes().toString().padStart(2, '0')
      expect(result).toBe(`${year}-${month}-${day} ${hours}:${minutes}`)
    })
  })

  describe('formatRelativeTime', () => {
    let now: number

    beforeEach(() => {
      now = new Date('2024-03-15 12:00:00').getTime()
      vi.useFakeTimers()
      vi.setSystemTime(now)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    /**
     * 测试：当时间差为几秒前应返回"刚刚"
     */
    it('should return "刚刚" when time difference is seconds ago', () => {
      const timestamp = now - 30 * 1000 // 30秒前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('刚刚')
    })

    /**
     * 测试：当时间差为几分钟前应返回"X分钟前"
     */
    it('should return "X分钟前" when time difference is minutes ago', () => {
      const timestamp = now - 5 * 60 * 1000 // 5分钟前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('5分钟前')
    })

    /**
     * 测试：当时间差为几小时前应返回"X小时前"
     */
    it('should return "X小时前" when time difference is hours ago', () => {
      const timestamp = now - 3 * 60 * 60 * 1000 // 3小时前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('3小时前')
    })

    /**
     * 测试：当时间差为几天前前应返回"X天前"
     */
    it('should return "X天前" when time difference is days ago', () => {
      const timestamp = now - 2 * 24 * 60 * 60 * 1000 // 2天前
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('2天前')
    })

    /**
     * 测试：当时间差正好为1分钟时应返回"1分钟前"
     */
    it('should return "1分钟前" when time difference is exactly 1 minute', () => {
      const timestamp = now - 60 * 1000
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('1分钟前')
    })

    /**
     * 测试：当时间差正好为1小时时应返回"1小时前"
     */
    it('should return "1小时前" when time difference is exactly 1 hour', () => {
      const timestamp = now - 60 * 60 * 1000
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('1小时前')
    })

    /**
     * 测试：当时间差正好为1天时应返回"1天前"
     */
    it('should return "1天前" when time difference is exactly 1 day', () => {
      const timestamp = now - 24 * 60 * 60 * 1000
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('1天前')
    })

    /**
     * 测试：当传入未来时间时应返回负数时间差
     */
    it('should handle future time correctly', () => {
      const timestamp = now + 60 * 60 * 1000 // 1小时后
      const result = formatRelativeTime(timestamp)
      expect(result).toBe('刚刚') // 因为计算结果是负数，会被当作0处理
    })

    /**
     * 测试：当传入时间戳为0时应返回天数（从1970年到现在）
     */
    it('should return days since epoch when timestamp is zero', () => {
      const result = formatRelativeTime(0)
      // 从1970年到现在应该返回天数（超过0天）
      expect(result).toMatch(/\d+天前/)
    })
  })

  describe('formatGameDuration', () => {
    /**
     * 测试：当传入秒数时应返回正确的分:秒格式
     */
    it('should return correct M:SS format when given seconds', () => {
      const result = formatGameDuration(1530) // 25分30秒
      expect(result).toBe('25:30')
    })

    /**
     * 测试：当传入少于60秒时应正确处理
     */
    it('should handle less than 60 seconds correctly', () => {
      const result = formatGameDuration(45)
      expect(result).toBe('0:45')
    })

    /**
     * 测试：当传入正好60秒时应返回1:00
     */
    it('should return 1:00 when given exactly 60 seconds', () => {
      const result = formatGameDuration(60)
      expect(result).toBe('1:00')
    })

    /**
     * 测试：当传入0秒时应返回0:00
     */
    it('should return 0:00 when given zero seconds', () => {
      const result = formatGameDuration(0)
      expect(result).toBe('0:00')
    })

    /**
     * 测试：当传入秒数应补零
     */
    it('should pad seconds with zero when less than 10', () => {
      const result = formatGameDuration(125) // 2分5秒
      expect(result).toBe('2:05')
    })

    /**
     * 测试：当传入长时间游戏应正确处理
     */
    it('should handle long game duration correctly', () => {
      const result = formatGameDuration(3600) // 60分钟
      expect(result).toBe('60:00')
    })

    /**
     * 测试：当传入负数秒数时应正确处理
     */
    it('should handle negative seconds correctly', () => {
      const result = formatGameDuration(-30)
      expect(result).toBe('-1:-30') // 负数秒数计算为 -1 分钟 -30 秒
    })
  })
})
