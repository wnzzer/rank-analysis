import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'

// Mocks must be hoisted before the import
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))
vi.mock('@renderer/services/ai/stream', () => ({
  requestAIContent: vi.fn()
}))

import type { invoke as InvokeFn } from '@tauri-apps/api/core'
import type { requestAIContent as RequestAIContentFn } from '@renderer/services/ai/stream'
import type { TagSuggestOutcome } from '../index'

const fakeGoodAIResponse = JSON.stringify({
  good: [
    {
      name: '中路雕将',
      desc: '中路场均 KDA ≥ 5',
      condition: {
        type: 'history',
        filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
        refresh: { type: 'count', op: '>=', value: 3 }
      }
    }
  ],
  bad: []
})

function fakeGame(win: boolean, puuid = 'me', queueId = 420) {
  return {
    gameId: Math.random(),
    queueId,
    gameDuration: 1800,
    participants: [{ championId: 1, stats: { win, kills: 5, deaths: 1, assists: 3 } }],
    participantIdentities: [{ player: { puuid } }]
  }
}

// Re-imported each test after vi.resetModules() to clear module-level cachedPuuid.
let invoke: MockedFunction<typeof InvokeFn>
let requestAIContent: MockedFunction<typeof RequestAIContentFn>
let requestTagSuggestions: (forceRefresh?: boolean) => Promise<TagSuggestOutcome>
let MIN_GAMES_REQUIRED: number
let getCacheKey: (puuid: string) => string

beforeEach(async () => {
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.resetModules()

  // Re-import mocks and module under test after resetting modules
  const coreMock = await import('@tauri-apps/api/core')
  invoke = coreMock.invoke as MockedFunction<typeof InvokeFn>

  const streamMock = await import('@renderer/services/ai/stream')
  requestAIContent = streamMock.requestAIContent as MockedFunction<typeof RequestAIContentFn>

  const mod = await import('../index')
  requestTagSuggestions = mod.requestTagSuggestions
  MIN_GAMES_REQUIRED = mod.MIN_GAMES_REQUIRED
  getCacheKey = mod.getCacheKey
})

describe('requestTagSuggestions', () => {
  it('returns insufficient when game count < MIN_GAMES_REQUIRED', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '单双排', value: 420 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: [fakeGame(true)] } } // only 1 game
      }
      throw new Error('unexpected: ' + cmd)
    })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') expect(r.gameCount).toBe(1)
  })

  it('hits AI and parses on first call', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '单双排', value: 420 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return {
          games: {
            games: Array.from({ length: MIN_GAMES_REQUIRED * 2 }, () => fakeGame(true))
          }
        }
      }
      throw new Error('unexpected: ' + cmd)
    })
    requestAIContent.mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.result.good).toHaveLength(1)
      expect(r.result.good[0].name).toBe('中路雕将')
      expect(r.puuid).toBe('me')
    }
  })

  it('uses cache on second call (no second AI fetch)', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '单双排', value: 420 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    requestAIContent.mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    await requestTagSuggestions()
    await requestTagSuggestions()
    expect(requestAIContent).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh bypasses cache', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '单双排', value: 420 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    requestAIContent.mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    await requestTagSuggestions()
    await requestTagSuggestions(true)
    expect(requestAIContent).toHaveBeenCalledTimes(2)
  })

  it('returns aiError when requestAIContent fails', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '单双排', value: 420 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    requestAIContent.mockResolvedValue({ success: false, error: 'network down' })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('aiError')
    if (r.kind === 'aiError') expect(r.error).toContain('network')
  })

  it('returns parseError when JSON is malformed', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '单双排', value: 420 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    requestAIContent.mockResolvedValue({ success: true, content: 'not json' })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('parseError')
  })

  it('returns aiError when AI returns empty content (proxy issue)', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '单双排', value: 420 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    requestAIContent.mockResolvedValue({ success: true, content: '' })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('aiError')
    if (r.kind === 'aiError') expect(r.error).toContain('空响应')
  })

  it('uses queue name from get_game_modes for queueName field', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes')
        return [
          { label: '全部', value: 0 },
          { label: '大乱斗', value: 450 }
        ]
      if (cmd === 'get_match_history_by_puuid') {
        return {
          games: {
            games: Array.from({ length: 10 }, () => fakeGame(true, 'me', 450))
          }
        }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    // We can't directly inspect features (orchestrator doesn't return them) — instead
    // assert the get_game_modes invoke was made.
    const { requestTagSuggestions: rts } = await import('../index')
    await rts(true) // forceRefresh to bypass any sessionStorage
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_game_modes')
  })
})

describe('cache key', () => {
  it('keys by puuid', () => {
    expect(getCacheKey('me')).toBe('ai_tag_suggest_me')
  })
})
