import { describe, it, expect, beforeEach } from 'vitest'
import {
  isRiotIdLike,
  buildPlayerSuggestions,
  loadSearchHistory,
  pushSearchHistory,
  type PlayerSuggestion
} from './useSearchSuggestions'

describe('isRiotIdLike', () => {
  it('名字#tag 形态判定为 Riot ID', () => {
    expect(isRiotIdLike('某玩家#12345')).toBe(true)
    expect(isRiotIdLike('name with space#CN1')).toBe(true)
  })

  it('自然语言/缺 tag/多个 # 不算', () => {
    expect(isRiotIdLike('这个月我用女警赢的那把')).toBe(false)
    expect(isRiotIdLike('某玩家#')).toBe(false)
    expect(isRiotIdLike('#12345')).toBe(false)
    expect(isRiotIdLike('a#b#c')).toBe(false)
    expect(isRiotIdLike('')).toBe(false)
  })
})

describe('buildPlayerSuggestions', () => {
  const sources = {
    friends: [
      { name: '好友甲#111', source: 'friend' },
      { name: '好友乙#222', source: 'friend' }
    ] as PlayerSuggestion[],
    notes: [
      { name: '好友甲#111', source: 'note' },
      { name: '备注哥#333', source: 'note' }
    ] as PlayerSuggestion[],
    history: [{ name: '历史姐#444', region: 'HN1', source: 'history' }] as PlayerSuggestion[]
  }

  it('大小写不敏感子串匹配,好友优先去重', () => {
    const out = buildPlayerSuggestions('好友甲', sources)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('friend')
  })

  it('分组排序:好友 → 备注 → 历史', () => {
    const out = buildPlayerSuggestions('', sources)
    expect(out.map(s => s.source)).toEqual(['friend', 'friend', 'note', 'history'])
  })

  it('无匹配返回空数组', () => {
    expect(buildPlayerSuggestions('不存在', sources)).toEqual([])
  })

  it('每个来源最多 4 条', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      name: `好友${i}#000`,
      source: 'friend' as const
    }))
    const out = buildPlayerSuggestions('好友', { friends: many, notes: [], history: [] })
    expect(out).toHaveLength(4)
  })
})

describe('searchHistory (localStorage)', () => {
  beforeEach(() => localStorage.clear())

  it('push 后可读回,最近在前', () => {
    pushSearchHistory('甲#1', '')
    pushSearchHistory('乙#2', 'HN1')
    const h = loadSearchHistory()
    expect(h[0].name).toBe('乙#2')
    expect(h[0].region).toBe('HN1')
    expect(h[1].name).toBe('甲#1')
  })

  it('同名同区去重(提升到最前),上限 20', () => {
    for (let i = 0; i < 25; i++) pushSearchHistory(`玩家${i}#0`, '')
    pushSearchHistory('玩家3#0', '')
    const h = loadSearchHistory()
    expect(h).toHaveLength(20)
    expect(h[0].name).toBe('玩家3#0')
    expect(h.filter(e => e.name === '玩家3#0')).toHaveLength(1)
  })

  it('存储损坏时返回空数组', () => {
    localStorage.setItem('searchHistory.v1', '{oops')
    expect(loadSearchHistory()).toEqual([])
  })
})
