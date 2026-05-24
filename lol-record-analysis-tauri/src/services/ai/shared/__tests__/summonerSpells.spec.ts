import { describe, it, expect } from 'vitest'
import { spellIdToName, spellIdsToNames } from '../summonerSpells'

describe('spellIdToName', () => {
  it('returns 闪现 for id 4', () => {
    expect(spellIdToName(4)).toBe('闪现')
  })
  it('returns 传送 for id 12', () => {
    expect(spellIdToName(12)).toBe('传送')
  })
  it('returns 惩戒 for id 11', () => {
    expect(spellIdToName(11)).toBe('惩戒')
  })
  it('returns 点燃 for id 14', () => {
    expect(spellIdToName(14)).toBe('点燃')
  })
  it('returns 治疗 for id 7', () => {
    expect(spellIdToName(7)).toBe('治疗')
  })
  it('returns 屏障 for id 21', () => {
    expect(spellIdToName(21)).toBe('屏障')
  })
  it('returns 净化 for id 1', () => {
    expect(spellIdToName(1)).toBe('净化')
  })
  it('returns 虚弱 for id 3', () => {
    expect(spellIdToName(3)).toBe('虚弱')
  })
  it('returns 幽魂 for id 6', () => {
    expect(spellIdToName(6)).toBe('幽魂')
  })
  it('returns 洞悉 for id 13', () => {
    expect(spellIdToName(13)).toBe('洞悉')
  })
  it('returns 雪球 for id 32', () => {
    expect(spellIdToName(32)).toBe('雪球')
  })
  it('returns "未知技能" for unknown id', () => {
    expect(spellIdToName(999)).toBe('未知技能')
  })
})

describe('spellIdsToNames', () => {
  it('maps an array of spell ids in order', () => {
    expect(spellIdsToNames([4, 12])).toEqual(['闪现', '传送'])
  })
  it('handles empty array', () => {
    expect(spellIdsToNames([])).toEqual([])
  })
})
