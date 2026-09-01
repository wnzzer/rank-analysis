import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import type { Game } from '@renderer/types/domain/match'
import {
  isRiotIdLike,
  buildPlayerSuggestions,
  loadSearchHistory,
  pushSearchHistory,
  recordSearchHistory,
  extractRecentPlayers,
  type PlayerSuggestion
} from './useSearchSuggestions'

const mockInvoke = invoke as ReturnType<typeof vi.fn>

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

  it('分组排序:好友 → 备注 → 历史 → 对局过', () => {
    const out = buildPlayerSuggestions('', {
      ...sources,
      played: [{ name: '路人王#555', source: 'played' }]
    })
    expect(out.map(s => s.source)).toEqual(['friend', 'friend', 'note', 'history', 'played'])
  })

  it('对局过的玩家与好友重名时保留好友来源', () => {
    const out = buildPlayerSuggestions('好友甲', {
      ...sources,
      played: [{ name: '好友甲#111', source: 'played' }]
    })
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('friend')
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

describe('recordSearchHistory (成功后写入)', () => {
  beforeEach(() => {
    localStorage.clear()
    mockInvoke.mockReset()
  })

  it('已知玩家(候选行)直接写入,不发验证请求', async () => {
    await recordSearchHistory('好友甲#111', '', { known: true })
    expect(loadSearchHistory()[0]?.name).toBe('好友甲#111')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('当前区手输名字:召唤师存在才写入', async () => {
    mockInvoke.mockResolvedValue({ puuid: 'p' })
    await recordSearchHistory('真实存在#123', '')
    expect(mockInvoke).toHaveBeenCalledWith('get_summoner_by_name', { name: '真实存在#123' })
    expect(loadSearchHistory()[0]?.name).toBe('真实存在#123')
  })

  it('当前区手输名字:召唤师不存在不写入', async () => {
    mockInvoke.mockRejectedValue(new Error('SummonerNotFound'))
    await recordSearchHistory('打错的名字#000', '')
    expect(loadSearchHistory()).toEqual([])
  })

  it('跨区搜索无法便宜验证,直接写入', async () => {
    await recordSearchHistory('跨区玩家#123', 'HN1')
    expect(loadSearchHistory()[0]?.region).toBe('HN1')
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('extractRecentPlayers', () => {
  function gameWith(names: [string, string][], date: string): Game {
    return {
      gameCreationDate: date,
      participants: [],
      gameDetail: {
        participants: [],
        participantIdentities: names.map(([n, t], i) => ({
          player: { gameName: n, tagLine: t, puuid: n === '我' ? 'me' : `p${n}${i}` }
        }))
      }
    } as unknown as Game
  }

  it('提取全部同局玩家,排除自己,按出现顺序去重', () => {
    const games = [
      gameWith(
        [
          ['我', '1'],
          ['甲', '2'],
          ['乙', '3']
        ],
        '2026-08-30T10:00:00.000Z'
      ),
      gameWith(
        [
          ['甲', '2'],
          ['我', '1'],
          ['丙', '4']
        ],
        '2026-08-29T10:00:00.000Z'
      )
    ]
    const out = extractRecentPlayers(games, 'me')
    expect(out.map(s => s.name)).toEqual(['甲#2', '乙#3', '丙#4'])
    expect(out.every(s => s.source === 'played')).toBe(true)
  })

  it('跳过没有 gameName 的条目(人机等)', () => {
    const games = [
      gameWith(
        [
          ['我', '1'],
          ['', '0']
        ],
        '2026-08-30T10:00:00.000Z'
      )
    ]
    expect(extractRecentPlayers(games, 'me')).toEqual([])
  })
})
