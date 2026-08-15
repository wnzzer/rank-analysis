/**
 * 对位情报服务单元测试
 *
 * 覆盖推荐条位置筛选的两层纯函数：
 * - `normalizeLcuPosition`：LCU 小写分路 → OP.GG 命名（大小写不敏感）
 * - `resolvePanelPosition`：面板筛选值 → useBestPicks 的 myPosition 入参
 * @module services/counterIntel
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeLcuPosition,
  PICK_POSITION_OPTIONS,
  resolvePanelPosition,
  type PickPositionFilter
} from './counterIntel'

describe('counterIntel', () => {
  describe('normalizeLcuPosition', () => {
    it('should map LCU lowercase positions to OP.GG naming', () => {
      expect(normalizeLcuPosition('top')).toBe('TOP')
      expect(normalizeLcuPosition('jungle')).toBe('JUNGLE')
      expect(normalizeLcuPosition('middle')).toBe('MID')
      expect(normalizeLcuPosition('bottom')).toBe('ADC')
      expect(normalizeLcuPosition('utility')).toBe('SUPPORT')
    })

    it('should pass through uppercase and mixed-case inputs', () => {
      expect(normalizeLcuPosition('MIDDLE')).toBe('MID')
      expect(normalizeLcuPosition('BOTTOM')).toBe('ADC')
      expect(normalizeLcuPosition('UtIlItY')).toBe('SUPPORT')
      expect(normalizeLcuPosition('TOP')).toBe('TOP')
    })

    it('should return null for unknown or empty positions', () => {
      expect(normalizeLcuPosition('')).toBeNull()
      expect(normalizeLcuPosition('captain')).toBeNull()
      expect(normalizeLcuPosition('none')).toBeNull()
    })
  })

  describe('PICK_POSITION_OPTIONS', () => {
    it('should start with follow and all options', () => {
      expect(PICK_POSITION_OPTIONS[0]).toEqual({ label: '跟随我的分路', value: 'follow' })
      expect(PICK_POSITION_OPTIONS[1]).toEqual({ label: '全部位置', value: 'all' })
    })

    it('should cover all five lanes with LCU values', () => {
      const lanes = PICK_POSITION_OPTIONS.filter(o => o.value !== 'follow' && o.value !== 'all')
      expect(lanes.map(o => o.value)).toEqual(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
    })
  })

  describe('resolvePanelPosition', () => {
    it('should resolve follow to normalized my position', () => {
      expect(resolvePanelPosition('follow', 'top')).toBe('TOP')
      expect(resolvePanelPosition('follow', 'UTILITY')).toBe('SUPPORT')
      expect(resolvePanelPosition('follow', 'bottom')).toBe('ADC')
    })

    it('should resolve follow to empty string when my position is unknown', () => {
      expect(resolvePanelPosition('follow', '')).toBe('')
      expect(resolvePanelPosition('follow', 'invalid')).toBe('')
    })

    it('should resolve all to empty string regardless of my position', () => {
      expect(resolvePanelPosition('all', 'top')).toBe('')
      expect(resolvePanelPosition('all', '')).toBe('')
    })

    it('should resolve explicit lanes to OP.GG naming', () => {
      expect(resolvePanelPosition('TOP', 'top')).toBe('TOP')
      expect(resolvePanelPosition('JUNGLE', '')).toBe('JUNGLE')
      expect(resolvePanelPosition('MIDDLE', 'bottom')).toBe('MID')
      expect(resolvePanelPosition('BOTTOM', '')).toBe('ADC')
      expect(resolvePanelPosition('UTILITY', '')).toBe('SUPPORT')
    })

    it('should be type-safe for all PickPositionFilter values', () => {
      const filters: PickPositionFilter[] = [
        'follow',
        'all',
        'TOP',
        'JUNGLE',
        'MIDDLE',
        'BOTTOM',
        'UTILITY'
      ]
      expect(filters.length).toBe(7)
      expect(filters.every(f => typeof resolvePanelPosition(f, '') === 'string')).toBe(true)
    })
  })
})
