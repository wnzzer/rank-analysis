import { describe, it, expect } from 'vitest'
import { inferTeamPosition } from '../positionInfer'

describe('inferTeamPosition', () => {
  describe('explicit position passthrough', () => {
    it('returns existing teamPosition unchanged when set', () => {
      expect(
        inferTeamPosition({
          teamPosition: 'JUNGLE',
          spellIds: [4, 11],
          championId: 64
        })
      ).toBe('JUNGLE')
    })
    it('treats empty string as UNKNOWN and falls through', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 11],
          championId: 64
        })
      ).toBe('JUNGLE')
    })
    it('treats NONE as UNKNOWN and falls through', () => {
      expect(
        inferTeamPosition({
          teamPosition: 'NONE',
          spellIds: [4, 11],
          championId: 64
        })
      ).toBe('JUNGLE')
    })
  })

  describe('jungle inference', () => {
    it('Smite present → JUNGLE regardless of champion', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 11],
          championId: 22 // Ashe (ADC) but with smite
        })
      ).toBe('JUNGLE')
    })
  })

  describe('top inference', () => {
    it('Teleport + fighter champ → TOP', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 12],
          championId: 86 // Garen
        })
      ).toBe('TOP')
    })
  })

  describe('middle inference', () => {
    it('Teleport + mage champ → MIDDLE', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 12],
          championId: 1 // Annie
        })
      ).toBe('MIDDLE')
    })
    it('Ignite + assassin → MIDDLE', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 14],
          championId: 91 // Talon
        })
      ).toBe('MIDDLE')
    })
  })

  describe('bottom inference', () => {
    it('Heal + ADC → BOTTOM', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 7],
          championId: 22 // Ashe
        })
      ).toBe('BOTTOM')
    })
    it('Barrier + ADC → BOTTOM', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 21],
          championId: 51 // Caitlyn
        })
      ).toBe('BOTTOM')
    })
  })

  describe('utility inference', () => {
    it('Heal + support champ → UTILITY', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 7],
          championId: 412 // Thresh
        })
      ).toBe('UTILITY')
    })
    it('Exhaust + support → UTILITY', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 3],
          championId: 117 // Lulu
        })
      ).toBe('UTILITY')
    })
  })

  describe('champion-class fallback（技能无信号时按职业分布兜底）', () => {
    it('ADC 英雄 + 闪现疾行（无治疗/屏障）→ BOTTOM（国服真机：MF 闪疾走下路）', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 6],
          championId: 21 // 赏金猎人
        })
      ).toBe('BOTTOM')
    })
    it('辅助英雄 + 闪现点燃 → UTILITY', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 14],
          championId: 412 // 锤石
        })
      ).toBe('UTILITY')
    })
    it('战士英雄不做职业兜底（中单剑豪误判上单的风险大于收益）→ UNKNOWN', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 6],
          championId: 122 // 诺克萨斯之手
        })
      ).toBe('UNKNOWN')
    })
  })

  describe('unknown fallback', () => {
    it('no Smite/Teleport/Heal cues + unknown champ → UNKNOWN', () => {
      expect(
        inferTeamPosition({
          teamPosition: '',
          spellIds: [4, 14],
          championId: 999999 // unknown
        })
      ).toBe('UNKNOWN')
    })
  })
})
