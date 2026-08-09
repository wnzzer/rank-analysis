/**
 * Record 组件工具函数单元测试
 * @module components/record/composition
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  kdaColor,
  killsColor,
  deathsColor,
  assistsColor,
  groupRateColor,
  healColorAndTaken,
  otherColor,
  dotFillCount,
  safeRelativePercent,
  formatCompactNumber,
  winRateColor,
  winRate,
  initModeOptions,
  modeOptions
} from './composition'

// Mock IPC service
vi.mock('../../services/ipc', () => ({
  getGameModesByIpc: vi.fn()
}))

import { getGameModesByIpc } from '../../services/ipc'

describe('composition', () => {
  describe('kdaColor', () => {
    /**
     * 测试：当 KDA >= 2.6 时应返回 good 颜色（暗黑模式）
     */
    it('should return good color when KDA is high in dark mode', () => {
      const result = kdaColor(3.0, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当 KDA >= 2.6 时应返回 good 颜色（亮色模式）
     */
    it('should return good color when KDA is high in light mode', () => {
      const result = kdaColor(3.0, false)
      expect(result).toBe('#2d8a6c')
    })

    /**
     * 测试：当 KDA <= 1.3 时应返回 bad 颜色
     */
    it('should return bad color when KDA is low', () => {
      const result = kdaColor(1.0, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当 KDA 在中间范围时应返回 neutral 颜色
     */
    it('should return neutral color when KDA is in middle range', () => {
      const result = kdaColor(2.0, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })

    /**
     * 测试：当 KDA 正好为 2.6 时应返回 good 颜色
     */
    it('should return good color when KDA is exactly 2.6', () => {
      const result = kdaColor(2.6, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当 KDA 正好为 1.3 时应返回 bad 颜色
     */
    it('should return bad color when KDA is exactly 1.3', () => {
      const result = kdaColor(1.3, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当未指定模式时应默认使用暗黑模式
     */
    it('should default to dark mode when isDark not specified', () => {
      const result = kdaColor(3.0)
      expect(result).toBe('#8BDFB7')
    })
  })

  describe('killsColor', () => {
    /**
     * 测试：当击杀 >= 8 时应返回 good 颜色
     */
    it('should return good color when kills are 8 or more', () => {
      const result = killsColor(8, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当击杀 <= 3 时应返回 bad 颜色
     */
    it('should return bad color when kills are 3 or fewer', () => {
      const result = killsColor(3, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当击杀在中间范围时应返回 neutral 颜色
     */
    it('should return neutral color when kills are in middle range', () => {
      const result = killsColor(5, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })
  })

  describe('deathsColor', () => {
    /**
     * 测试：当死亡 >= 8 时应返回 bad 颜色
     */
    it('should return bad color when deaths are 8 or more', () => {
      const result = deathsColor(8, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当死亡 <= 3 时应返回 good 颜色
     */
    it('should return good color when deaths are 3 or fewer', () => {
      const result = deathsColor(3, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当死亡在中间范围时应返回 neutral 颜色
     */
    it('should return neutral color when deaths are in middle range', () => {
      const result = deathsColor(5, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })
  })

  describe('assistsColor', () => {
    /**
     * 测试：当助攻 >= 10 时应返回 good 颜色
     */
    it('should return good color when assists are 10 or more', () => {
      const result = assistsColor(10, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当助攻 <= 3 时应返回 bad 颜色
     */
    it('should return bad color when assists are 3 or fewer', () => {
      const result = assistsColor(3, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当助攻在中间范围时应返回 neutral 颜色
     */
    it('should return neutral color when assists are in middle range', () => {
      const result = assistsColor(5, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })
  })

  describe('groupRateColor', () => {
    /**
     * 测试：当组排率 >= 45 时应返回 good 颜色
     */
    it('should return good color when group rate is 45 or more', () => {
      const result = groupRateColor(45, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当组排率 <= 15 时应返回 bad 颜色
     */
    it('should return bad color when group rate is 15 or fewer', () => {
      const result = groupRateColor(15, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当组排率在中间范围时应返回 neutral 颜色
     */
    it('should return neutral color when group rate is in middle range', () => {
      const result = groupRateColor(30, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })
  })

  describe('healColorAndTaken', () => {
    /**
     * 测试：当数值 >= 25 时应返回 good 颜色
     */
    it('should return good color when value is 25 or more', () => {
      const result = healColorAndTaken(25, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当数值 < 25 时应返回 neutral 颜色
     */
    it('should return neutral color when value is less than 25', () => {
      const result = healColorAndTaken(20, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })
  })

  describe('otherColor', () => {
    /**
     * 测试：当数值 >= 25 时应返回 good 颜色
     */
    it('should return good color when value is 25 or more', () => {
      const result = otherColor(25, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当数值 <= 15 时应返回 bad 颜色
     */
    it('should return bad color when value is 15 or fewer', () => {
      const result = otherColor(15, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当数值在中间范围时应返回 neutral 颜色
     */
    it('should return neutral color when value is in middle range', () => {
      const result = otherColor(20, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })
  })

  describe('winRateColor', () => {
    /**
     * 测试：当胜率 >= 57 时应返回 good 颜色
     */
    it('should return good color when win rate is 57 or more', () => {
      const result = winRateColor(57, true)
      expect(result).toBe('#8BDFB7')
    })

    /**
     * 测试：当胜率 <= 49 时应返回 bad 颜色
     */
    it('should return bad color when win rate is 49 or fewer', () => {
      const result = winRateColor(49, true)
      expect(result).toBe('#BA3F53')
    })

    /**
     * 测试：当胜率在中间范围时应返回 neutral 颜色
     */
    it('should return neutral color when win rate is in middle range', () => {
      const result = winRateColor(53, true)
      expect(result).toBe('rgba(255, 255, 255, 0.7)')
    })
  })

  describe('winRate', () => {
    /**
     * 测试：当传入胜负场时应正确计算胜率
     */
    it('should calculate win rate correctly when given wins and losses', () => {
      const result = winRate(7, 3)
      expect(result).toBe(70)
    })

    /**
     * 测试：当总场次为0时应返回0
     */
    it('should return zero when no games played', () => {
      const result = winRate(0, 0)
      expect(result).toBe(0)
    })

    /**
     * 测试：当全胜时应返回100
     */
    it('should return 100 when all games are wins', () => {
      const result = winRate(10, 0)
      expect(result).toBe(100)
    })

    /**
     * 测试：当全败时应返回0
     */
    it('should return 0 when all games are losses', () => {
      const result = winRate(0, 10)
      expect(result).toBe(0)
    })

    /**
     * 测试：当胜率需要四舍五入时应正确处理
     */
    it('should round win rate correctly', () => {
      // 2/3 = 0.666... -> 67%
      const result = winRate(2, 1)
      expect(result).toBe(67)
    })

    /**
     * 测试：当胜负相等时应返回50
     */
    it('should return 50 when wins equal losses', () => {
      const result = winRate(5, 5)
      expect(result).toBe(50)
    })
  })

  describe('dotFillCount', () => {
    /**
     * 测试：当传入100时应返回5
     */
    it('should return 5 when rate is 100', () => {
      const result = dotFillCount(100)
      expect(result).toBe(5)
    })

    /**
     * 测试：当传入0时应返回0
     */
    it('should return 0 when rate is 0', () => {
      const result = dotFillCount(0)
      expect(result).toBe(0)
    })

    /**
     * 测试：当传入undefined时应返回0
     */
    it('should return 0 when rate is undefined', () => {
      const result = dotFillCount(undefined)
      expect(result).toBe(0)
    })

    /**
     * 测试：当传入50时应返回3（四舍五入）
     */
    it('should return 3 when rate is 50', () => {
      const result = dotFillCount(50)
      expect(result).toBe(3)
    })

    /**
     * 测试：当传入超过100时应限制为5
     */
    it('should cap at 5 when rate exceeds 100', () => {
      const result = dotFillCount(150)
      expect(result).toBe(5)
    })

    /**
     * 测试：当传入负数时应限制为0
     */
    it('should floor at 0 when rate is negative', () => {
      const result = dotFillCount(-50)
      expect(result).toBe(0)
    })
  })

  describe('safeRelativePercent', () => {
    /**
     * 测试：当传入有效值时应正确计算百分比
     */
    it('should calculate percentage correctly for valid values', () => {
      const result = safeRelativePercent(50, 100)
      expect(result).toBe(50)
    })

    /**
     * 测试：当最大值为0时应返回0
     */
    it('should return 0 when max value is zero', () => {
      const result = safeRelativePercent(50, 0)
      expect(result).toBe(0)
    })

    /**
     * 测试：当值为0时应返回0
     */
    it('should return 0 when value is zero', () => {
      const result = safeRelativePercent(0, 100)
      expect(result).toBe(0)
    })

    /**
     * 测试：当值为负数时应返回0
     */
    it('should return 0 when value is negative', () => {
      const result = safeRelativePercent(-10, 100)
      expect(result).toBe(0)
    })

    /**
     * 测试：当百分比超过100时应限制为100
     */
    it('should cap at 100 when percentage exceeds 100', () => {
      const result = safeRelativePercent(150, 100)
      expect(result).toBe(100)
    })

    /**
     * 测试：当值大于最大值时应限制为100
     */
    it('should cap at 100 when value exceeds max', () => {
      const result = safeRelativePercent(200, 100)
      expect(result).toBe(100)
    })

    /**
     * 测试：当最大值和值都为负数时应返回0
     */
    it('should return 0 when both value and max are negative', () => {
      const result = safeRelativePercent(-50, -100)
      expect(result).toBe(0)
    })

    /**
     * 测试：当计算结果需要四舍五入时应正确处理
     */
    it('should round percentage correctly', () => {
      const result = safeRelativePercent(2, 3)
      expect(result).toBe(67)
    })
  })

  describe('formatCompactNumber', () => {
    /**
     * 测试：当传入小于1000的数字时应原样返回
     */
    it('should return number as is when less than 1000', () => {
      const result = formatCompactNumber(999)
      expect(result).toBe('999')
    })

    /**
     * 测试：当传入1000-9999的数字时应格式化为k
     */
    it('should format number to k when between 1000 and 9999', () => {
      const result = formatCompactNumber(1500)
      expect(result).toBe('1.50k')
    })

    /**
     * 测试：当传入10000-999999的数字时应格式化为k（可能带1位小数）
     */
    it('should format number to k when between 10000 and 999999', () => {
      const result = formatCompactNumber(15000)
      // 实际实现会移除 .0 后缀
      expect(result).toBe('15k')
    })

    /**
     * 测试：当传入大于等于1000000的数字时应格式化为m
     */
    it('should format number to m when 1000000 or more', () => {
      const result = formatCompactNumber(1500000)
      expect(result).toBe('1.5m')
    })

    /**
     * 测试：当传入1000-9999的数字时应格式化为k（2位小数）
     */
    it('should format number to k with 2 decimals when between 1000 and 9999', () => {
      const result = formatCompactNumber(2000)
      expect(result).toBe('2.00k')
    })

    /**
     * 测试：当传入0时应返回0
     */
    it('should return 0 when value is zero', () => {
      const result = formatCompactNumber(0)
      expect(result).toBe('0')
    })

    /**
     * 测试：当传入非有限数时应返回--
     */
    it('should return -- when value is not finite', () => {
      expect(formatCompactNumber(Infinity)).toBe('--')
      expect(formatCompactNumber(-Infinity)).toBe('--')
      expect(formatCompactNumber(NaN)).toBe('--')
    })

    /**
     * 测试：当传入负数时应返回原数字符串
     */
    it('should return original number string for negative numbers', () => {
      const result = formatCompactNumber(-1500)
      // 负数不符合 >= 1000 条件，直接返回原数字符串
      expect(result).toBe('-1500')
    })
  })

  describe('initModeOptions', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      // Reset modeOptions to default
      modeOptions.value = [{ label: '全部', value: 0, key: 0 }]
    })

    /**
     * 测试：当成功获取游戏模式时应更新 modeOptions
     */
    it('should update modeOptions when game modes are fetched successfully', async () => {
      const mockModes = [
        { label: '全部', value: 0 },
        { label: '排位赛', value: 420 },
        { label: '大乱斗', value: 450 }
      ]
      vi.mocked(getGameModesByIpc).mockResolvedValue(mockModes)

      await initModeOptions()

      expect(getGameModesByIpc).toHaveBeenCalled()
      expect(modeOptions.value).toEqual([
        { label: '全部', value: 0, key: 0 },
        { label: '排位赛', value: 420, key: 420 },
        { label: '大乱斗', value: 450, key: 450 }
      ])
    })

    /**
     * 测试：当获取游戏模式失败时应保持默认值
     */
    it('should keep default value when fetching game modes fails', async () => {
      vi.mocked(getGameModesByIpc).mockRejectedValue(new Error('Network error'))

      await initModeOptions()

      expect(getGameModesByIpc).toHaveBeenCalled()
      expect(modeOptions.value).toEqual([{ label: '全部', value: 0, key: 0 }])
    })

    /**
     * 测试：当返回空数组时应更新为空数组
     */
    it('should update to empty array when no game modes returned', async () => {
      vi.mocked(getGameModesByIpc).mockResolvedValue([])

      await initModeOptions()

      expect(modeOptions.value).toEqual([])
    })
  })
})
