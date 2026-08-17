/**
 * useLiveAIAnalysis 单元测试
 *
 * 回归重点（D-P2 对局中 tab）：
 * - 进入对局自动轮询快照、离开对局停轮询并清快照（结果保留）；
 * - 自动发起带 3 分钟限流，显式 rerun 不受限且先补一轮最新快照；
 * - 快照缺失不发起（弹提示），只有 AI 流式失败才报错；
 * - extras 里带我方 summonerName 与 PUGG 推荐（7 槽第一名），无推荐则不传。
 *
 * 注：本环境 Vue 调度器不靠微任务排空外部 awaited promise，断言前统一
 * 用 flushPromises()（含 macrotask），不要用裸 nextTick()。
 *
 * @module composables/useLiveAIAnalysis
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import type { StreamCallbacks } from '@renderer/services/ai'
import type { LiveGameSnapshot } from '@renderer/services/liveGame'

const messageStub = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('naive-ui', () => ({ useMessage: () => messageStub }))
vi.mock('@renderer/services/ai', () => ({
  analyzeLiveGameWithAIStream: vi.fn()
}))
vi.mock('@renderer/services/liveGame', () => ({
  getLiveGameData: vi.fn()
}))
vi.mock('@renderer/services/builds', () => ({
  getBuildStats: vi.fn()
}))

import { analyzeLiveGameWithAIStream } from '@renderer/services/ai'
import { getLiveGameData } from '@renderer/services/liveGame'
import { getBuildStats } from '@renderer/services/builds'
import { useLiveAIAnalysis } from './useLiveAIAnalysis'

const mockStream = vi.mocked(analyzeLiveGameWithAIStream)
const mockPoll = vi.mocked(getLiveGameData)
const mockStats = vi.mocked(getBuildStats)

let captured: StreamCallbacks | null = null

const SNAPSHOT: LiveGameSnapshot = {
  gameTime: 623.5,
  gameData: { gameMode: 'CLASSIC', gameTime: 623.5 },
  events: [],
  players: [
    {
      summonerName: 'MidLaner',
      championName: 'Ahri',
      position: 'MIDDLE',
      team: 'ORDER',
      isDead: false,
      level: 13,
      items: [{ itemID: 3157, itemCount: 1 }],
      scores: { kills: 6, deaths: 1, assists: 4, creepScore: 178, wardScore: 12 },
      gold: { total: 11050 }
    }
  ]
}

const ME = {
  gameName: 'MidLaner',
  tagLine: 'CN1',
  summonerLevel: 300,
  profileIconId: 1,
  profileIconKey: '',
  puuid: 'PUUID-1',
  platformIdCn: ''
}

const SESSION = {
  phase: 'InProgress',
  type: 'CLASSIC',
  typeCn: '排位',
  queueId: 420,
  gameMode: 'CLASSIC',
  isMultiTeam: false,
  mySubteamId: 1,
  subteams: [
    {
      subteamId: 1,
      players: [
        {
          championId: 103,
          summoner: ME,
          matchHistory: null,
          userTag: null,
          rank: null,
          meetGames: [],
          preGroupMarkers: {}
        }
      ]
    }
  ]
}

function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T
  const Wrapper = defineComponent({
    setup() {
      result = composable()
      return () => null
    }
  })
  const wrapper = mount(Wrapper)
  return { result, unmount: () => wrapper.unmount() }
}

function setup(phase = 'InProgress') {
  const sessionData = reactive(JSON.parse(JSON.stringify(SESSION))) as any
  sessionData.phase = phase
  const mySummoner = ref(ME)
  return withSetup(() => useLiveAIAnalysis(sessionData, { mySummoner }))
}

/** 假定时器下排空微任务 + Vue flushJobs（fake timers 会连 queueMicrotask 一起伪造） */
describe('useLiveAIAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured = null
    mockPoll.mockResolvedValue(SNAPSHOT)
    mockStats.mockResolvedValue({
      championId: 103,
      position: '',
      mode: 420,
      samples: 10,
      winCount: 6,
      items: [
        [{ itemId: 3157, count: 10, winCount: 6 }],
        [{ itemId: 3020, count: 8, winCount: 5 }],
        [],
        [],
        [],
        [],
        []
      ],
      runeMain: [],
      runeSub: [],
      keystone: [],
      spells: []
    })
    mockStream.mockImplementation((_snap, callbacks) => {
      captured = callbacks
      return new Promise<void>(() => {})
    })
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })
  it('进入对局：自动轮询拿到快照', async () => {
    const { result, unmount } = setup()
    await flushPromises()
    expect(result.inGame.value).toBe(true)
    expect(mockPoll).toHaveBeenCalledTimes(1)
    expect(result.snapshot.value).toEqual(SNAPSHOT)
    expect(result.lastPollAt.value).not.toBeNull()
    unmount()
  })

  it('按 pollIntervalMs 周期轮询', async () => {
    const sessionData = reactive(JSON.parse(JSON.stringify(SESSION))) as any
    const { unmount } = withSetup(() =>
      useLiveAIAnalysis(sessionData, { mySummoner: ref(ME), pollIntervalMs: 50 })
    )
    await flushPromises()
    expect(mockPoll).toHaveBeenCalledTimes(1)
    // 50ms 间隔轮询：waitFor 轮询等待（固定 200ms 在全量并行负载大时会不足）
    await vi.waitFor(() => {
      expect(mockPoll.mock.calls.length).toBeGreaterThanOrEqual(4)
    })
    unmount()
  })

  it('离开对局：停轮询、清快照，结果保留', async () => {
    const sessionData = reactive(JSON.parse(JSON.stringify(SESSION))) as any
    const { result, unmount } = withSetup(() =>
      useLiveAIAnalysis(sessionData, { mySummoner: ref(ME) })
    )
    await flushPromises()
    expect(result.snapshot.value).toEqual(SNAPSHOT)

    result.ensureStarted()
    await flushPromises()
    captured!.onChunk('## 出装诊断')
    captured!.onDone()
    await flushPromises()

    sessionData.phase = 'EndOfGame'
    await flushPromises()
    expect(result.inGame.value).toBe(false)
    expect(result.snapshot.value).toBeNull()
    expect(result.lastPollAt.value).toBeNull()
    expect(result.result.value).toContain('出装诊断') // 对局结束后复盘仍可看
    unmount()
  })

  it('ensureStarted：发起分析并带上我方名与推荐出装', async () => {
    const { result, unmount } = setup()
    await flushPromises()
    result.ensureStarted()
    await flushPromises()

    expect(result.loading.value).toBe(true)
    expect(mockStream).toHaveBeenCalledTimes(1)
    const [snap, , extras] = mockStream.mock.calls[0]
    expect(snap).toEqual(SNAPSHOT)
    expect(extras.myGameName).toBe('MidLaner')
    // PUGG 7 槽第一名 → 前两件非空
    expect(extras.recommendedItems).toHaveLength(7)
    expect(extras.recommendedItems![0]!.itemId).toBe(3157)
    expect(extras.recommendedItems![1]!.itemId).toBe(3020)
    unmount()
  })

  it('PUGG 无数据（null）：不传 recommendedItems 也不报错', async () => {
    mockStats.mockResolvedValue(null)
    const { result, unmount } = setup()
    await flushPromises()
    result.ensureStarted()
    await flushPromises()

    const [, , extras] = mockStream.mock.calls[0]
    expect(extras.recommendedItems).toBeUndefined()
    unmount()
  })

  it('快照缺失（非对局/轮询失败）：不发起分析，只提示', async () => {
    mockPoll.mockResolvedValue(null)
    const { result, unmount } = setup()
    await flushPromises()

    result.ensureStarted()
    await flushPromises()

    expect(mockStream).not.toHaveBeenCalled()
    expect(messageStub.warning).toHaveBeenCalled()
    expect(result.loading.value).toBe(false)
    unmount()
  })

  it('rerun：先补一轮最新快照再重跑，不受限流约束', async () => {
    const { result, unmount } = setup()
    await flushPromises()
    result.ensureStarted()
    await flushPromises()
    captured!.onChunk('旧结果')
    captured!.onDone()
    await flushPromises()

    mockPoll.mockResolvedValue({ ...SNAPSHOT, gameTime: 700 })
    void result.rerun()
    await flushPromises()

    expect(result.result.value).toBe('')
    expect(result.loading.value).toBe(true)
    expect(mockStream).toHaveBeenCalledTimes(2)
    // rerun 先补了一次快照（初次轮询 1 次 + rerun 1 次 = 2 次）
    expect(mockPoll).toHaveBeenCalledTimes(2)
    const [snap] = mockStream.mock.calls[1]
    expect((snap as LiveGameSnapshot).gameTime).toBe(700)
    unmount()
  })

  it('自动发起限流：3 分钟内重复 ensureStarted 不重复请求，超窗恢复', async () => {
    const { result, unmount } = setup()
    await flushPromises()
    result.ensureStarted()
    await flushPromises()
    expect(mockStream).toHaveBeenCalledTimes(1)
    captured!.onDone()
    await flushPromises()

    result.ensureStarted()
    await flushPromises()
    expect(mockStream).toHaveBeenCalledTimes(1) // 限流中

    vi.setSystemTime(new Date(2026, 0, 1, 12, 3, 1))
    result.ensureStarted()
    await flushPromises()
    expect(mockStream).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('有结果后 ensureStarted 不重跑（面板重开只看结果）', async () => {
    const { result, unmount } = setup()
    await flushPromises()
    result.ensureStarted()
    await flushPromises()
    captured!.onChunk('## 经济落后')
    captured!.onDone()
    await flushPromises()

    result.ensureStarted()
    await flushPromises()
    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(result.result.value).toContain('经济落后')
    unmount()
  })

  it('阶段切换重置限流：离开对局再回来可立即自动发起', async () => {
    const sessionData = reactive(JSON.parse(JSON.stringify(SESSION))) as any
    const { result, unmount } = withSetup(() =>
      useLiveAIAnalysis(sessionData, { mySummoner: ref(ME) })
    )
    await flushPromises()
    result.ensureStarted()
    await flushPromises()
    expect(mockStream).toHaveBeenCalledTimes(1)
    captured!.onDone()
    await flushPromises()

    sessionData.phase = 'ChampSelect'
    await flushPromises()
    sessionData.phase = 'InProgress'
    await flushPromises()
    // 回来后重新轮询到快照，且限流台账已复位
    result.ensureStarted()
    await flushPromises()
    expect(mockStream).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('AI 流式失败：loading 复位并弹错', async () => {
    const { result, unmount } = setup()
    await flushPromises()
    result.ensureStarted()
    await flushPromises()
    captured!.onError('boom')
    await flushPromises()

    expect(result.loading.value).toBe(false)
    expect(messageStub.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
    unmount()
  })
})
