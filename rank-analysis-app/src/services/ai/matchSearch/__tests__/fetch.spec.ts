import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import type { Game } from '@renderer/types/domain/match'
import { emptyQuery } from '../schema'
import { fetchGamesForQuery, PAGE_SIZE, MAX_GAMES_WITH_RANGE, MAX_GAMES_NO_RANGE } from '../fetch'

const mockInvoke = invoke as ReturnType<typeof vi.fn>

/** 造 n 局对局,日期从 startDay 起每局往前推 1 天(新→旧) */
function gamesFrom(startDay: string, n: number): Game[] {
  const start = new Date(`${startDay}T12:00:00.000Z`).getTime()
  return Array.from({ length: n }, (_, i) => {
    return {
      gameId: start - i,
      gameCreationDate: new Date(start - i * 24 * 3600 * 1000).toISOString()
    } as Game
  })
}

/** 按「完整战绩序列」实现 SGP mock:begIndex/count 切片 */
function mockSgpFromTimeline(all: Game[]) {
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'get_my_summoner') return { gameName: '我', tagLine: '10000', puuid: 'me' }
    if (cmd === 'get_current_sgp_region') return 'HN1'
    if (cmd === 'get_sgp_match_history_by_name') {
      const beg = args!.begIndex as number
      const count = args!.count as number
      return { games: { games: all.slice(beg, beg + count) } }
    }
    throw new Error(`unexpected cmd ${cmd}`)
  })
}

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('fetchGamesForQuery', () => {
  it('页内最旧一局越过时间下限即停止翻页', async () => {
    // 120 局,每天一局:第一页(20 局)就覆盖到 20 天前
    mockSgpFromTimeline(gamesFrom('2026-09-01', 120))
    const q = { ...emptyQuery(), timeRange: { from: '2026-08-25', to: null } }
    const r = await fetchGamesForQuery(q)
    expect(r.source).toBe('sgp')
    expect(r.truncated).toBe(false)
    expect(r.games).toHaveLength(PAGE_SIZE) // 只翻了一页
    const sgpCalls = mockInvoke.mock.calls.filter(c => c[0] === 'get_sgp_match_history_by_name')
    expect(sgpCalls).toHaveLength(1)
  })

  it('无时间窗按 MAX_GAMES_NO_RANGE 截断并标记 truncated', async () => {
    mockSgpFromTimeline(gamesFrom('2026-09-01', MAX_GAMES_NO_RANGE + 50))
    const r = await fetchGamesForQuery(emptyQuery())
    expect(r.games).toHaveLength(MAX_GAMES_NO_RANGE)
    expect(r.truncated).toBe(true)
  })

  it('有时间窗上限为 MAX_GAMES_WITH_RANGE', async () => {
    // 500 局全部在时间窗内(from 很早)
    mockSgpFromTimeline(gamesFrom('2026-09-01', 500))
    const q = { ...emptyQuery(), timeRange: { from: '2020-01-01', to: null } }
    const r = await fetchGamesForQuery(q)
    expect(r.games).toHaveLength(MAX_GAMES_WITH_RANGE)
    expect(r.truncated).toBe(true)
  })

  it('短页(到头)自然停止,不算截断', async () => {
    mockSgpFromTimeline(gamesFrom('2026-09-01', 7))
    const r = await fetchGamesForQuery(emptyQuery())
    expect(r.games).toHaveLength(7)
    expect(r.truncated).toBe(false)
  })

  it('SGP 失败降级 LCU 最近 50 局', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_my_summoner') return { gameName: '我', tagLine: '10000', puuid: 'me' }
      if (cmd === 'get_current_sgp_region') throw new Error('无法确定当前大区')
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: gamesFrom('2026-09-01', 50) } }
      }
      throw new Error(`unexpected cmd ${cmd}`)
    })
    const r = await fetchGamesForQuery(emptyQuery())
    expect(r.source).toBe('lcu')
    expect(r.games).toHaveLength(50)
    expect(r.selfName).toBe('我#10000')
  })

  it('进度回调随翻页递增并带最旧日期', async () => {
    mockSgpFromTimeline(gamesFrom('2026-09-01', 45))
    const seen: number[] = []
    let lastOldest: string | null = null
    await fetchGamesForQuery(emptyQuery(), p => {
      seen.push(p.fetched)
      lastOldest = p.oldestDate
    })
    expect(seen).toEqual([20, 40, 45])
    expect(lastOldest).not.toBeNull()
  })

  it('LCU 未连接(get_my_summoner 失败)时抛可展示错误', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_my_summoner') throw new Error('conn refused')
      return null
    })
    await expect(fetchGamesForQuery(emptyQuery())).rejects.toThrow('客户端')
  })
})
