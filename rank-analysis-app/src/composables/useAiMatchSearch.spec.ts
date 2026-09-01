import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@renderer/services/ai/matchSearch/parse', () => ({ parseMatchQuery: vi.fn() }))
vi.mock('@renderer/services/ai/matchSearch/fetch', () => ({ fetchGamesForQuery: vi.fn() }))
vi.mock('@renderer/services/ai/champion-names', () => ({
  loadChampionNames: vi.fn().mockResolvedValue(undefined),
  getChampionName: (id: number) => `英雄${id}`
}))

import type { Game } from '@renderer/types/domain/match'
import { parseMatchQuery } from '@renderer/services/ai/matchSearch/parse'
import { fetchGamesForQuery } from '@renderer/services/ai/matchSearch/fetch'
import { emptyQuery } from '@renderer/services/ai/matchSearch/schema'
import { useAiMatchSearch } from './useAiMatchSearch'

const mockParse = parseMatchQuery as ReturnType<typeof vi.fn>
const mockFetch = fetchGamesForQuery as ReturnType<typeof vi.fn>

/** 最小对局:自己用 championId,可选带一个队友 */
function gameOf(opts: { championId: number; win?: boolean; allyName?: string }): Game {
  const players = [
    { championId: opts.championId, teamId: 100, name: '我', tag: '1' },
    ...(opts.allyName ? [{ championId: 999, teamId: 100, name: opts.allyName, tag: '2' }] : [])
  ]
  return {
    gameId: Math.random(),
    gameCreationDate: '2026-08-15T12:00:00.000Z',
    queueId: 420,
    participants: [
      {
        teamId: 100,
        championId: opts.championId,
        stats: { win: opts.win ?? true }
      }
    ],
    gameDetail: {
      participants: players.map((p, i) => ({
        participantId: i + 1,
        teamId: p.teamId,
        championId: p.championId,
        stats: { win: opts.win ?? true }
      })),
      participantIdentities: players.map((p, i) => ({
        player: { gameName: p.name, tagLine: p.tag, puuid: `p${i}` }
      }))
    }
  } as unknown as Game
}

beforeEach(() => {
  mockParse.mockReset()
  mockFetch.mockReset()
})

describe('useAiMatchSearch', () => {
  it('happy path:parsing → fetching → done,按条件过滤结果', async () => {
    mockParse.mockResolvedValue({ ...emptyQuery(), selfChampionIds: [51] })
    mockFetch.mockResolvedValue({
      games: [gameOf({ championId: 51 }), gameOf({ championId: 64 })],
      source: 'sgp',
      truncated: false,
      selfName: '我#1'
    })
    const s = useAiMatchSearch()
    await s.run('我用女警那把')
    expect(s.phase.value).toBe('done')
    expect(s.results.value).toHaveLength(1)
    expect(s.results.value[0].participants[0].championId).toBe(51)
    expect(s.meta.value).toMatchObject({ source: 'sgp', truncated: false, searchedCount: 2 })
    expect(s.chips.value.map(c => c.key)).toContain('self:51')
  })

  it('解析失败进入 error 态并带可展示信息', async () => {
    mockParse.mockRejectedValue(new Error('AI 未能解析'))
    const s = useAiMatchSearch()
    await s.run('???')
    expect(s.phase.value).toBe('error')
    expect(s.error.value).toContain('AI 未能解析')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('拉取失败进入 error 态', async () => {
    mockParse.mockResolvedValue(emptyQuery())
    mockFetch.mockRejectedValue(new Error('无法获取当前召唤师'))
    const s = useAiMatchSearch()
    await s.run('x')
    expect(s.phase.value).toBe('error')
    expect(s.error.value).toContain('召唤师')
  })

  it('count 意图产出相遇统计', async () => {
    mockParse.mockResolvedValue({
      ...emptyQuery(),
      playerNames: ['老熟人#2'],
      intent: 'count_encounters'
    })
    mockFetch.mockResolvedValue({
      games: [gameOf({ championId: 51, allyName: '老熟人' }), gameOf({ championId: 51 })],
      source: 'sgp',
      truncated: false,
      selfName: '我#1'
    })
    const s = useAiMatchSearch()
    await s.run('跟老熟人碰过几次')
    expect(s.encounterStats.value?.total).toBe(1)
    expect(s.results.value).toHaveLength(1)
  })

  it('removeChip 本地重筛,不再调用 parse/fetch', async () => {
    mockParse.mockResolvedValue({ ...emptyQuery(), selfChampionIds: [51], result: 'win' })
    mockFetch.mockResolvedValue({
      games: [gameOf({ championId: 51, win: true }), gameOf({ championId: 64, win: true })],
      source: 'sgp',
      truncated: false,
      selfName: '我#1'
    })
    const s = useAiMatchSearch()
    await s.run('x')
    expect(s.results.value).toHaveLength(1)

    s.removeChip('self:51')
    expect(s.results.value).toHaveLength(2)
    expect(mockParse).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('拉取进度透传到 progress', async () => {
    mockParse.mockResolvedValue(emptyQuery())
    mockFetch.mockImplementation(async (_q, onProgress) => {
      onProgress?.({ fetched: 20, oldestDate: '2026-08-01T00:00:00.000Z' })
      return { games: [], source: 'sgp', truncated: false, selfName: '我#1' }
    })
    const s = useAiMatchSearch()
    await s.run('x')
    expect(s.progress.value.fetched).toBe(20)
  })
})
