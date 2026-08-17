import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock @tauri-apps/api/core BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Mock Tauri 事件（playerNotes store 落盘后跨窗口广播用）
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

import { invoke } from '@tauri-apps/api/core'
import {
  fetchBatchProfiles,
  injectNoteBriefs,
  __resetCacheForTests,
  type ProfileRequest
} from '../recentProfile.batch'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'

const mockInvoke = invoke as ReturnType<typeof vi.fn>

/** 只统计战绩拉取的 invoke 次数（备注开关的 get_config 调用不计入） */
const historyCallCount = () =>
  mockInvoke.mock.calls.filter(c => c[0] === 'get_match_history_by_puuid').length

beforeEach(() => {
  mockInvoke.mockReset()
  __resetCacheForTests()
  // buildNoteBrief（备注注入）依赖 pinia store
  setActivePinia(createPinia())
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

    // First call: 1 history invoke. Second call: cache hit → no additional invoke.
    expect(historyCallCount()).toBe(1)
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

    expect(historyCallCount()).toBe(2)
    vi.useRealTimers()
  })

  it('恒返回干净 profile：即使开关开且有备注也不含 note（注入是 injectNoteBriefs 的职责）', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p1', { note: '演员', label: 'blacklist', gameName: 'A', tagLine: '1' })
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_match_history_by_puuid') {
        return rawHistory(args.puuid, [
          rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
        ])
      }
      // 开关键不存在（视为开）——即便如此 fetchBatchProfiles 也不注入
      return null
    })

    const result = await fetchBatchProfiles([
      { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }
    ])

    expect(result.get('p1')).not.toBeNull()
    expect(result.get('p1')?.note).toBeUndefined()
  })
})

describe('SGP 跨区战绩兜底（fetchBatchProfiles + region/name）', () => {
  /** SGP 战绩响应的最小形状（Rust map_sgp_to_match_history 输出，[0]=被查玩家） */
  function sgpGame(opts: { championId: number; lane: string; win: boolean }) {
    return {
      queueId: 420,
      gameDetail: {
        participants: [
          {
            participantId: 1,
            championId: opts.championId,
            stats: { win: opts.win, kills: 3, deaths: 1, assists: 2 },
            timeline: { lane: opts.lane, role: 'SOLO' }
          }
        ]
      }
    }
  }

  const sgpCallCount = () =>
    mockInvoke.mock.calls.filter(c => c[0] === 'get_sgp_match_history_by_name').length

  it('本区无战绩 + region/name → 走 SGP 战绩兜底并聚合（含 timeline.lane 位置）', async () => {
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_match_history_by_puuid') return { games: { games: [] } }
      if (cmd === 'get_sgp_match_history_by_name') {
        expect(args.region).toBe('HN10')
        expect(args.name).toBe('跨区玩家#123')
        return {
          games: {
            games: [
              sgpGame({ championId: 64, lane: 'JUNGLE', win: true }),
              sgpGame({ championId: 64, lane: 'JUNGLE', win: false }),
              sgpGame({ championId: 86, lane: 'TOP', win: true })
            ]
          }
        }
      }
      return null
    })

    const result = await fetchBatchProfiles([
      {
        puuid: 'sgp-p',
        teamPosition: 'JUNGLE',
        championId: 64,
        region: 'HN10',
        name: '跨区玩家#123'
      }
    ])

    const profile = result.get('sgp-p')
    expect(profile).not.toBeNull()
    // 位置分布来自 timeline.lane：2/3 打野
    expect(profile?.positionDistribution[0]).toMatchObject({ pos: 'JUNGLE', games: 2 })
    // 英雄池：64 两场、86 一场
    const champs = profile?.championDistribution ?? []
    expect(champs[0]).toMatchObject({ championId: 64, games: 2 })
    expect(profile?.recentWinRate).toBeCloseTo(2 / 3)
    expect(sgpCallCount()).toBe(1)
  })

  it('本区无战绩但无 region → 不启用 SGP 兜底（返回空画像，不编造）', async () => {
    mockInvoke.mockImplementation(async (cmd, _args: any) => {
      if (cmd === 'get_match_history_by_puuid') return { games: { games: [] } }
      return null
    })

    const result = await fetchBatchProfiles([
      { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }
    ])

    expect(sgpCallCount()).toBe(0)
    // 空画像：无位置分布
    expect(result.get('p1')?.positionDistribution).toHaveLength(0)
  })

  it('SGP 兜底失败 → 该玩家空画像（不编造），不阻塞其他玩家', async () => {
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_match_history_by_puuid') {
        return args.puuid === 'p_bad'
          ? { games: { games: [] } }
          : rawHistory(args.puuid, [
              rawMatch({ puuid: args.puuid, teamPosition: 'TOP', championId: 86, win: true })
            ])
      }
      if (cmd === 'get_sgp_match_history_by_name') throw new Error('SGP network')
      return null
    })

    const result = await fetchBatchProfiles([
      { puuid: 'p_bad', teamPosition: 'JUNGLE', championId: 64, region: 'NA1', name: 'x#000' },
      { puuid: 'p_ok', teamPosition: 'TOP', championId: 86 }
    ])

    expect(result.get('p_bad')?.positionDistribution).toHaveLength(0)
    expect(result.get('p_ok')?.positionDistribution.length ?? 0).toBeGreaterThan(0)
  })

  it('SGP 兜底结果同样进 LRU 缓存：二次查询不重复调 SGP', async () => {
    mockInvoke.mockImplementation(async (cmd, _args: any) => {
      if (cmd === 'get_match_history_by_puuid') return { games: { games: [] } }
      if (cmd === 'get_sgp_match_history_by_name') {
        return { games: { games: [sgpGame({ championId: 64, lane: 'JUNGLE', win: true })] } }
      }
      return null
    })

    const req: ProfileRequest = {
      puuid: 'sgp-p',
      teamPosition: 'JUNGLE',
      championId: 64,
      region: 'HN10',
      name: 'A#1'
    }
    await fetchBatchProfiles([req])
    await fetchBatchProfiles([req])

    expect(sgpCallCount()).toBe(1)
  })
})

describe('injectNoteBriefs', () => {
  /** get_config 按 aiUsePlayerNotes 返回指定值 */
  function mockConfig(useNotesValue: boolean | undefined) {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_config') {
        return useNotesValue === undefined ? null : { value: useNotesValue }
      }
      return null
    })
  }

  /** 构造一个干净（无 note）的 profile map */
  async function buildCleanMap(puuids: string[]) {
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_match_history_by_puuid') {
        return rawHistory(args.puuid, [
          rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
        ])
      }
      return null
    })
    return fetchBatchProfiles(
      puuids.map(puuid => ({ puuid, teamPosition: 'JUNGLE' as const, championId: 64 }))
    )
  }

  it('开关默认开（键不存在）时注入 profile.note', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p1', { note: '演员', label: 'blacklist', gameName: 'A', tagLine: '1' })
    const cleanMap = await buildCleanMap(['p1', 'p2'])
    mockConfig(undefined)

    const result = await injectNoteBriefs(cleanMap)

    expect(result.get('p1')?.note).toBe('[拉黑] 演员')
    // 无备注的玩家不带 note 字段
    expect(result.get('p2')?.note).toBeUndefined()
    // 入参 map 不被就地修改
    expect(cleanMap.get('p1')?.note).toBeUndefined()
  })

  it('开关显式关闭时不注入', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p1', { note: '演员', label: 'blacklist', gameName: 'A', tagLine: '1' })
    const cleanMap = await buildCleanMap(['p1'])
    mockConfig(false)

    const result = await injectNoteBriefs(cleanMap)

    expect(result.get('p1')?.note).toBeUndefined()
  })

  it('回归：先开后关——对同一个干净 map 再注入不得残留 note（隐私旁路）', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p1', { note: '演员', label: 'blacklist', gameName: 'A', tagLine: '1' })
    const cleanMap = await buildCleanMap(['p1'])

    // 第一次：开关开 → 带 note
    mockConfig(undefined)
    const first = await injectNoteBriefs(cleanMap)
    expect(first.get('p1')?.note).toBe('[拉黑] 演员')

    // 开关关掉后，对同一个干净 map 再调 → 不得带 note
    mockConfig(false)
    const second = await injectNoteBriefs(cleanMap)
    expect(second.get('p1')?.note).toBeUndefined()
  })
})
