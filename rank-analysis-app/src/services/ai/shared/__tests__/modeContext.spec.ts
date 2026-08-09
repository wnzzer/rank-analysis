import { describe, it, expect } from 'vitest'
import { classifyMode } from '../modeContext'

describe('classifyMode', () => {
  describe('ranked', () => {
    it('420 单双排位', () => {
      const ctx = classifyMode(420, 'CLASSIC')
      expect(ctx.kind).toBe('ranked')
      expect(ctx.hasLanes).toBe(true)
      expect(ctx.hasItemBuild).toBe(true)
      expect(ctx.hasAugmentSystem).toBe(false)
      expect(ctx.championAssignment).toBe('pick')
      expect(ctx.isTeamMode).toBe(false)
    })
    it('440 灵活组排', () => {
      expect(classifyMode(440, 'CLASSIC').kind).toBe('ranked')
    })
    it('430 匹配赛归入 ranked', () => {
      expect(classifyMode(430, 'CLASSIC').kind).toBe('ranked')
    })
    it('480 / 490 快速匹配', () => {
      expect(classifyMode(480, 'CLASSIC').kind).toBe('ranked')
      expect(classifyMode(490, 'CLASSIC').kind).toBe('ranked')
    })
    it('description mentions 召唤师峡谷 + BP', () => {
      const ctx = classifyMode(420, 'CLASSIC')
      expect(ctx.description).toContain('召唤师峡谷')
      expect(ctx.description).toContain('BP')
    })
  })

  describe('augment', () => {
    it('CHERRY mode 斗魂竞技场', () => {
      const ctx = classifyMode(1700, 'CHERRY')
      expect(ctx.kind).toBe('augment')
      expect(ctx.isTeamMode).toBe(true)
      expect(ctx.hasAugmentSystem).toBe(true)
      expect(ctx.hasItemBuild).toBe(false)
      expect(ctx.championAssignment).toBe('random')
    })
    it('queueId 2400 海克斯乱斗', () => {
      const ctx = classifyMode(2400, 'ARAM')
      expect(ctx.kind).toBe('augment')
      expect(ctx.isTeamMode).toBe(false)
      expect(ctx.hasAugmentSystem).toBe(true)
    })
    it('description forbids BP', () => {
      const ctx = classifyMode(2400, 'ARAM')
      expect(ctx.description).toContain('强化')
      expect(ctx.description).not.toContain('BP')
    })
    it('斗魂的 description 提到 2v2', () => {
      const ctx = classifyMode(1700, 'CHERRY')
      expect(ctx.description).toContain('2v2')
    })
  })

  describe('aram', () => {
    it('450 大乱斗', () => {
      const ctx = classifyMode(450, 'ARAM')
      expect(ctx.kind).toBe('aram')
      expect(ctx.hasLanes).toBe(false)
      expect(ctx.hasItemBuild).toBe(true)
      expect(ctx.hasAugmentSystem).toBe(false)
      expect(ctx.championAssignment).toBe('random-with-bench')
    })
    it('1300 觉醒之战', () => {
      expect(classifyMode(1300, 'ONEFORALL').kind).toBe('aram')
    })
    it('900 无限火力', () => {
      expect(classifyMode(900, 'URF').kind).toBe('aram')
    })
    it('description forbids 路位 / 补位', () => {
      const ctx = classifyMode(450, 'ARAM')
      expect(ctx.description).toContain('随机')
      expect(ctx.description).not.toContain('上中下打野辅助')
    })
  })

  describe('unknown fallback', () => {
    it('unrecognized queueId falls back to aram-like behavior', () => {
      const ctx = classifyMode(9999, 'UNKNOWN_GAMEMODE')
      expect(ctx.kind).toBe('aram')
      expect(ctx.hasLanes).toBe(false)
    })
  })
})
