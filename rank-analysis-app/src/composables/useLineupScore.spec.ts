/**
 * useLineupScore 单元测试：锁定集合 → 防抖取数 → 确定性强度分。
 *
 * 覆盖：空锁定不发请求；防抖合并；竞态丢弃；取数失败保持旧值；
 * 非锁定状态不计入；敌方 = 非我方 subteam；mode 切换重取。
 *
 * 注意：sessionData 必须传 reactive 对象（与 useSessionSync 产出一致），
 * 否则 watch 的 deep 依赖无法追踪子属性变更。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import { useLineupScore } from './useLineupScore'
import type { SessionData, Subteam } from '@renderer/types/domain/gaming'
import type { ChampionMeta } from '@renderer/services/opgg'
import type { RecentPlayerProfile } from '@renderer/services/ai/shared/types'

vi.mock('@renderer/services/opgg', () => ({
  getChampionMeta: vi.fn()
}))

vi.mock('@renderer/services/ai/shared/recentProfile.batch', () => ({
  fetchBatchProfiles: vi.fn()
}))

import { getChampionMeta } from '@renderer/services/opgg'
import { fetchBatchProfiles } from '@renderer/services/ai/shared/recentProfile.batch'

const mockedGetChampionMeta = vi.mocked(getChampionMeta)
const mockedFetchBatchProfiles = vi.mocked(fetchBatchProfiles)

const DEBOUNCE = 300

/** 构造 SessionData：mySubteamId=0 的队伍为「我」。players 只给选人期相关字段 */
function makeSession(
  subteams: Array<{
    id: number
    players: Array<{ id: number; pickState?: string; puuid?: string; position?: string }>
  }>
): SessionData {
  return {
    phase: 'ChampSelect',
    type: 'CLASSIC',
    typeCn: '经典对局',
    queueId: 420,
    gameMode: 'CLASSIC',
    isMultiTeam: false,
    mySubteamId: 0,
    subteams: subteams.map(s => ({
      subteamId: s.id,
      players: s.players.map(p => ({
        championId: p.id,
        pickState: p.pickState,
        summoner: { puuid: p.puuid ?? '' },
        assignedPosition: p.position ?? ''
      })) as unknown as Subteam['players']
    }))
  }
}

function meta(championId: number, winRate: number, tier: number): ChampionMeta {
  return {
    championId,
    position: 'top',
    tier,
    rank: 10,
    rankPrevPatch: 8,
    winRate,
    pickRate: 5,
    banRate: 1,
    roleRate: 30,
    isMainPosition: true
  }
}

describe('useLineupScore', () => {
  beforeEach(() => {
    mockedGetChampionMeta.mockReset()
    mockedFetchBatchProfiles.mockReset()
    mockedFetchBatchProfiles.mockResolvedValue(new Map())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 1)
    await nextTick()
  }

  it('无锁定英雄时不发任何请求，分数保持 EMPTY', async () => {
    const session = reactive(
      makeSession([
        {
          id: 0,
          players: [
            { id: 1, pickState: 'picking' },
            { id: 0, pickState: 'none' }
          ]
        },
        { id: 1, players: [{ id: 0, pickState: 'none' }] }
      ])
    )
    const { scores } = useLineupScore(session)
    await flush()
    expect(mockedGetChampionMeta).not.toHaveBeenCalled()
    expect(scores.value.mine).toEqual({
      score: null,
      covered: 0,
      total: 0,
      bestTier: null,
      playerAdjusted: false
    })
    expect(scores.value.enemy).toEqual({
      score: null,
      covered: 0,
      total: 0,
      bestTier: null,
      playerAdjusted: false
    })
  })

  it('锁定集合出现后防抖取数并算出双方强度分', async () => {
    const session = reactive(
      makeSession([
        {
          id: 0,
          players: [
            { id: 100, pickState: 'locked' },
            { id: 101, pickState: 'locked' }
          ]
        },
        { id: 1, players: [{ id: 200, pickState: 'locked' }] }
      ])
    )
    mockedGetChampionMeta.mockImplementation(async (_mode, championId) => {
      const rates: Record<number, [number, number]> = {
        100: [0.545, 1],
        101: [0.483, 3],
        200: [0.45, 2]
      }
      const r = rates[championId]
      return r ? meta(championId, r[0], r[1]) : null
    })

    const { scores, loading } = useLineupScore(session)
    expect(loading.value).toBe(false)
    await flush()

    // 我方均值 = (0.545 + 0.483) / 2 = 51.4
    expect(scores.value.mine).toEqual({
      score: 51.4,
      covered: 2,
      total: 2,
      bestTier: 1,
      playerAdjusted: false
    })
    expect(scores.value.enemy).toEqual({
      score: 45.0,
      covered: 1,
      total: 1,
      bestTier: 2,
      playerAdjusted: false
    })
    expect(mockedGetChampionMeta).toHaveBeenCalledTimes(3)
  })

  it('非 locked 的选中状态不计入阵容', async () => {
    const session = reactive(
      makeSession([
        {
          id: 0,
          players: [
            { id: 100, pickState: 'locked' },
            { id: 101, pickState: 'intent' }
          ]
        },
        { id: 1, players: [{ id: 0, pickState: 'none' }] }
      ])
    )
    mockedGetChampionMeta.mockResolvedValue(meta(100, 0.545, 1))

    const { scores } = useLineupScore(session)
    await flush()

    expect(scores.value.mine).toEqual({
      score: 54.5,
      covered: 1,
      total: 1,
      bestTier: 1,
      playerAdjusted: false
    })
    expect(mockedGetChampionMeta).toHaveBeenCalledTimes(1)
  })

  it('连续锁定变化被防抖合并为一次取数，以最新集合为准', async () => {
    const session = reactive(
      makeSession([
        { id: 0, players: [{ id: 100, pickState: 'locked' }] },
        { id: 1, players: [] }
      ])
    )
    const { scores } = useLineupScore(session)

    session.subteams[0].players = [
      { championId: 100, pickState: 'locked' } as unknown as Subteam['players'][number],
      { championId: 101, pickState: 'locked' } as unknown as Subteam['players'][number]
    ]
    // 注意：fake timers 会连 queueMicrotask 一起伪造，Vue 的 flushJobs 微任务
    // 只会在 advanceTimersByTimeAsync 里被排空——用 nextTick() 等不到 watch 回调。
    await vi.advanceTimersByTimeAsync(0)
    session.subteams[0].players = [
      { championId: 100, pickState: 'locked' } as unknown as Subteam['players'][number],
      { championId: 102, pickState: 'locked' } as unknown as Subteam['players'][number]
    ]
    await vi.advanceTimersByTimeAsync(0)

    mockedGetChampionMeta.mockImplementation(async (_mode, championId) => {
      const rates: Record<number, [number, number]> = {
        100: [0.5, 1],
        101: [0.6, 2],
        102: [0.7, 3]
      }
      const r = rates[championId]
      return r ? meta(championId, r[0], r[1]) : null
    })

    await flush()
    // 只取最终集合 {100, 102}，均值 (0.5+0.7)/2 = 60
    expect(scores.value.mine).toEqual({
      score: 60.0,
      covered: 2,
      total: 2,
      bestTier: 1,
      playerAdjusted: false
    })
    expect(mockedGetChampionMeta).toHaveBeenCalledTimes(2)
    expect(mockedGetChampionMeta.mock.calls.map(c => c[1]).sort()).toEqual([100, 102])
  })

  it('竞态：先发的慢请求结果被丢弃，不覆盖新集合分数', async () => {
    const session = reactive(
      makeSession([
        { id: 0, players: [{ id: 100, pickState: 'locked' }] },
        { id: 1, players: [] }
      ])
    )

    let resolveFirst!: (v: ChampionMeta | null) => void
    mockedGetChampionMeta
      .mockImplementationOnce(
        () => new Promise<ChampionMeta | null>(resolve => (resolveFirst = resolve))
      )
      .mockImplementation(async (_mode, championId) => meta(championId, 0.7, 3))

    const { scores } = useLineupScore(session)
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 1)
    await nextTick()

    // 集合变为 {100, 102}，触发第二次取数并先完成
    session.subteams[0].players = [
      { championId: 100, pickState: 'locked' } as unknown as Subteam['players'][number],
      { championId: 102, pickState: 'locked' } as unknown as Subteam['players'][number]
    ]
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 1)
    await nextTick()
    await nextTick()

    // 旧请求此刻才返回（若未被丢弃会覆盖成双方只有 100 的分数）
    resolveFirst(meta(100, 0.99, 1))
    await nextTick()

    const ids = session.subteams[0].players.map(p => p.championId).sort()
    expect(ids).toEqual([100, 102])
    expect(scores.value.mine.total).toBe(2)
    expect(scores.value.mine.bestTier).toBe(3)
  })

  it('取数失败保持上次分数、loading 复位、不抛错', async () => {
    const session = reactive(
      makeSession([
        { id: 0, players: [{ id: 100, pickState: 'locked' }] },
        { id: 1, players: [] }
      ])
    )
    mockedGetChampionMeta.mockResolvedValueOnce(meta(100, 0.545, 1))

    const { scores, loading } = useLineupScore(session)
    await flush()
    expect(scores.value.mine).toEqual({
      score: 54.5,
      covered: 1,
      total: 1,
      bestTier: 1,
      playerAdjusted: false
    })

    mockedGetChampionMeta.mockRejectedValueOnce(new Error('network'))
    session.subteams[0].players = [
      { championId: 101, pickState: 'locked' } as unknown as Subteam['players'][number]
    ]
    await flush()
    expect(scores.value.mine).toEqual({
      score: 54.5,
      covered: 1,
      total: 1,
      bestTier: 1,
      playerAdjusted: false
    })
    expect(loading.value).toBe(false)
  })

  it('无 OP.GG 数据的英雄：score 为 null、covered 0、total 计数保留', async () => {
    const session = reactive(
      makeSession([
        {
          id: 0,
          players: [
            { id: 100, pickState: 'locked' },
            { id: 101, pickState: 'locked' }
          ]
        },
        { id: 1, players: [] }
      ])
    )
    mockedGetChampionMeta.mockResolvedValue(null)

    const { scores } = useLineupScore(session)
    await flush()
    expect(scores.value.mine).toEqual({
      score: null,
      covered: 0,
      total: 2,
      bestTier: null,
      playerAdjusted: false
    })
  })

  it('mode 切换（ranked → aram）触发重新取数', async () => {
    const session = reactive(
      makeSession([
        { id: 0, players: [{ id: 100, pickState: 'locked' }] },
        { id: 1, players: [] }
      ])
    )
    const mode = ref<'ranked' | 'aram'>('ranked')
    mockedGetChampionMeta.mockResolvedValue(meta(100, 0.545, 1))

    const { scores } = useLineupScore(session, mode)
    await flush()
    expect(mockedGetChampionMeta.mock.calls[0][0]).toBe('ranked')

    mode.value = 'aram'
    mockedGetChampionMeta.mockResolvedValue(meta(100, 0.6, 2))
    await flush()
    expect(mockedGetChampionMeta.mock.calls.at(-1)![0]).toBe('aram')
    expect(scores.value.mine.score).toBe(60.0)
  })

  it('敌方为空/无 subteam 数据时保持 EMPTY，不发请求', async () => {
    const session = reactive(makeSession([{ id: 0, players: [] }]))
    const { scores } = useLineupScore(session)
    await flush()
    expect(mockedGetChampionMeta).not.toHaveBeenCalled()
    expect(scores.value.enemy.total).toBe(0)
  })
})

describe('useLineupScore with player profiles', () => {
  /** 画像：60% 近期胜率 → 每英雄 +2 分（playerLineupAdjustment +0.02） */
  function hotProfile(): RecentPlayerProfile {
    return {
      positionDistribution: [{ pos: 'JUNGLE', ratio: 1, games: 20 }],
      mainPosition: 'JUNGLE',
      currentLanePlayedRatio: 1,
      championDistribution: [],
      currentChampionMastery: null,
      recentWinRate: 0.6,
      recentKda: 3.5,
      streak: null,
      isOffRole: false,
      offRoleSeverity: 'none'
    }
  }

  beforeEach(() => {
    mockedGetChampionMeta.mockReset()
    mockedFetchBatchProfiles.mockReset()
    mockedFetchBatchProfiles.mockResolvedValue(new Map())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(301)
    await nextTick()
  }

  it('includePlayerProfiles=true 时按玩家画像加权（+2/英雄），并传对的位置与英雄', async () => {
    const session = reactive(
      makeSession([
        {
          id: 0,
          players: [{ id: 100, pickState: 'locked', puuid: 'p1', position: 'jungle' }]
        },
        { id: 1, players: [{ id: 200, pickState: 'locked', puuid: 'p2' }] }
      ])
    )
    mockedGetChampionMeta.mockResolvedValue(meta(100, 0.5, 1))
    mockedFetchBatchProfiles.mockResolvedValue(new Map([['p1', hotProfile()]]))

    const { scores } = useLineupScore(session, 'ranked', { includePlayerProfiles: true })
    await flush()

    // 请求：我方带 assignedPosition（jungle），敌方无位置 → UNKNOWN
    const requests = mockedFetchBatchProfiles.mock.calls[0][0]
    expect(requests).toContainEqual({
      puuid: 'p1',
      teamPosition: 'jungle',
      championId: 100
    })
    expect(requests).toContainEqual({ puuid: 'p2', teamPosition: 'UNKNOWN', championId: 200 })

    // 加权后：50 + 2 = 52；敌方无画像 → 原值
    expect(scores.value.mine.score).toBe(52.0)
    expect(scores.value.mine.playerAdjusted).toBe(true)
    expect(scores.value.enemy.score).toBe(50.0)
    expect(scores.value.enemy.playerAdjusted).toBe(false)
  })

  it('画像拉取失败/无 puuid 的玩家 → 纯 meta 出分，不阻塞、不抛错', async () => {
    const session = reactive(
      makeSession([
        { id: 0, players: [{ id: 100, pickState: 'locked', puuid: '' }] },
        { id: 1, players: [] }
      ])
    )
    mockedGetChampionMeta.mockResolvedValue(meta(100, 0.545, 1))

    const { scores, loading } = useLineupScore(session, 'ranked', {
      includePlayerProfiles: true
    })
    await flush()

    expect(mockedFetchBatchProfiles).toHaveBeenCalledWith([]) // 无 puuid 全部跳过
    expect(scores.value.mine.score).toBe(54.5)
    expect(scores.value.mine.playerAdjusted).toBe(false)
    expect(loading.value).toBe(false)
  })

  it('includePlayerProfiles 缺省 → 不拉画像，行为与旧版一致', async () => {
    const session = reactive(
      makeSession([
        { id: 0, players: [{ id: 100, pickState: 'locked', puuid: 'p1' }] },
        { id: 1, players: [] }
      ])
    )
    mockedGetChampionMeta.mockResolvedValue(meta(100, 0.5, 1))

    const { scores } = useLineupScore(session)
    await flush()

    expect(mockedFetchBatchProfiles).not.toHaveBeenCalled()
    expect(scores.value.mine.score).toBe(50.0)
  })
})
