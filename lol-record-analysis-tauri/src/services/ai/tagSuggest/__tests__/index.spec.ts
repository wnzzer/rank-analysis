import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be hoisted before the import
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))
vi.mock('@renderer/services/ai/stream', () => ({
  requestAIContent: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { requestAIContent } from '@renderer/services/ai/stream'
import { requestTagSuggestions, MIN_GAMES_REQUIRED, getCacheKey } from '../index'

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

function fakeGame(win: boolean, puuid = 'me') {
  return {
    gameId: Math.random(),
    queueId: 420,
    gameDuration: 1800,
    participants: [{ championId: 1, stats: { win, kills: 5, deaths: 1, assists: 3 } }],
    participantIdentities: [{ player: { puuid } }]
  }
}

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('requestTagSuggestions', () => {
  it('returns insufficient when game count < MIN_GAMES_REQUIRED', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return {
          games: {
            games: Array.from({ length: MIN_GAMES_REQUIRED * 2 }, () => fakeGame(true))
          }
        }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.result.good).toHaveLength(1)
      expect(r.result.good[0].name).toBe('中路雕将')
    }
  })

  it('uses cache on second call (no second AI fetch)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    await requestTagSuggestions()
    await requestTagSuggestions()
    expect(vi.mocked(requestAIContent)).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh bypasses cache', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    await requestTagSuggestions()
    await requestTagSuggestions(true)
    expect(vi.mocked(requestAIContent)).toHaveBeenCalledTimes(2)
  })

  it('returns aiError when requestAIContent fails', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: false, error: 'network down' })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('aiError')
    if (r.kind === 'aiError') expect(r.error).toContain('network')
  })

  it('returns parseError when JSON is malformed', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: 'not json' })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('parseError')
  })

  it('returns aiError when AI returns empty content (proxy issue)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: '' })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('aiError')
    if (r.kind === 'aiError') expect(r.error).toContain('空响应')
  })
})

describe('cache key', () => {
  it('keys by puuid', () => {
    expect(getCacheKey('me')).toBe('ai_tag_suggest_me')
  })
})
