import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock @tauri-apps/api/core BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { fetchBatchProfiles, __resetCacheForTests } from '../recentProfile.batch'

const mockInvoke = invoke as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockInvoke.mockReset()
  __resetCacheForTests()
})

function rawMatch(opts: { puuid: string; teamPosition: string; championId: number; win: boolean }) {
  return {
    queueId: 420,
    gameId: Math.random(),
    gameDuration: 1500,
    participants: [
      {
        participantId: 1,
        championId: opts.championId,
        teamPosition: opts.teamPosition,
        spell1Id: 4,
        spell2Id: 11,
        stats: { win: opts.win, kills: 5, deaths: 3, assists: 7 }
      }
    ],
    participantIdentities: [{ participantId: 1, player: { puuid: opts.puuid } }]
  }
}

function rawHistory(_puuid: string, games: ReturnType<typeof rawMatch>[]) {
  return { games: { games } }
}

describe('fetchBatchProfiles', () => {
  it('returns a profile per puuid in parallel', async () => {
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_match_history_by_puuid') {
        return rawHistory(args.puuid, [
          rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
        ])
      }
    })

    const result = await fetchBatchProfiles([
      { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 },
      { puuid: 'p2', teamPosition: 'TOP', championId: 86 }
    ])

    expect(result.size).toBe(2)
    expect(result.get('p1')).not.toBeNull()
    expect(result.get('p2')).not.toBeNull()
  })

  it('isolates individual failures', async () => {
    mockInvoke.mockImplementation(async (_cmd, args: any) => {
      if (args.puuid === 'p_bad') throw new Error('LCU offline')
      return rawHistory(args.puuid, [
        rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
      ])
    })

    const result = await fetchBatchProfiles([
      { puuid: 'p_ok', teamPosition: 'JUNGLE', championId: 64 },
      { puuid: 'p_bad', teamPosition: 'TOP', championId: 86 }
    ])

    expect(result.get('p_ok')).not.toBeNull()
    expect(result.get('p_bad')).toBeNull()
  })

  it('hits LRU on second call within TTL', async () => {
    mockInvoke.mockImplementation(async (_cmd, args: any) => {
      return rawHistory(args.puuid, [
        rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
      ])
    })

    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])
    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])

    // First call: 1 invoke. Second call: cache hit → no additional invoke.
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('re-fetches if cache expired (advance fake timers)', async () => {
    vi.useFakeTimers()
    mockInvoke.mockImplementation(async (_cmd, args: any) =>
      rawHistory(args.puuid, [
        rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
      ])
    )

    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])
    vi.advanceTimersByTime(11 * 60 * 1000) // 11 minutes
    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
