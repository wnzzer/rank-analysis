/**
 * useGrowthReport 单元测试
 *
 * 回归重点：
 * - 纯用户触发式：generate 有样本才能跑；样本不足直接 warning 不发请求
 * - 已在进行中时重复 generate 被忽略（loading 互斥）
 * - 流式 chunk 累积、done 复位 loading；error 弹错并复位
 * - rerun 语义 = 直接覆盖旧结果
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { StreamCallbacks } from '@renderer/services/ai'
import type { RecentData } from '@renderer/types/domain/analysis'

const messageStub = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('naive-ui', () => ({ useMessage: () => messageStub }))
vi.mock('@renderer/services/ai', () => ({
  analyzeGrowthReportWithAIStream: vi.fn()
}))

import { analyzeGrowthReportWithAIStream } from '@renderer/services/ai'
import { useGrowthReport } from './useGrowthReport'

const mockAnalyze = vi.mocked(analyzeGrowthReportWithAIStream)

/** 捕获流式回调，让测试自己驱动 chunk/done/error 的时机 */
let captured: StreamCallbacks | null = null
function armStream(): void {
  mockAnalyze.mockImplementation((_recent, callbacks) => {
    captured = callbacks
    return new Promise<void>(() => {})
  })
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

function recentData(samples = 10): RecentData {
  return {
    kda: 3.2,
    kills: 6.5,
    deaths: 4.1,
    assists: 7.8,
    wins: 0,
    losses: 0,
    selectMode: 420,
    selectModeCn: '单双排',
    selectWins: 6,
    selectLosses: 4,
    flexWins: 0,
    flexLosses: 0,
    groupRate: 55,
    averageGold: 13200,
    goldRate: 21,
    averageDamageDealtToChampions: 20480,
    damageDealtToChampionsRate: 24,
    samples,
    averageCsPerMin: 6.8,
    averageVisionScore: 27.4,
    oneGamePlayers: {},
    friendAndDispute: {
      friendsRate: 0,
      disputeRate: 0,
      friendsSummoner: [],
      disputeSummoner: []
    }
  }
}

describe('useGrowthReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured = null
  })

  it('样本充足时生成：chunk 累积、done 复位 loading', async () => {
    const { result } = withSetup(() => useGrowthReport())
    armStream()

    // 不 await：mock 永不 settle，由测试驱动 onChunk/onDone 完成生命周期
    void result.generate(recentData())
    await nextTick()
    expect(result.loading.value).toBe(true)

    captured!.onChunk('你最近的')
    captured!.onChunk('补刀速率不错')
    expect(result.result.value).toBe('你最近的补刀速率不错')

    captured!.onDone()
    await nextTick()
    expect(result.loading.value).toBe(false)
    expect(messageStub.error).not.toHaveBeenCalled()
  })

  it('样本不足（samples=0）：warning 且不发请求', async () => {
    const { result } = withSetup(() => useGrowthReport())

    await result.generate(recentData(0))

    expect(messageStub.warning).toHaveBeenCalled()
    expect(mockAnalyze).not.toHaveBeenCalled()
    expect(result.loading.value).toBe(false)
  })

  it('已在进行中时重复 generate 被忽略（loading 互斥）', async () => {
    const { result } = withSetup(() => useGrowthReport())
    armStream()

    void result.generate(recentData())
    await nextTick()
    expect(result.loading.value).toBe(true)
    expect(mockAnalyze).toHaveBeenCalledTimes(1)

    await result.generate(recentData())
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
  })

  it('流式报错：弹错并复位 loading', async () => {
    const { result } = withSetup(() => useGrowthReport())
    armStream()

    void result.generate(recentData())
    await nextTick()
    captured!.onError('模型超时')
    await nextTick()

    expect(messageStub.error).toHaveBeenCalledWith(expect.stringContaining('模型超时'))
    expect(result.loading.value).toBe(false)
  })

  it('重新生成：直接覆盖旧结果重新发起', async () => {
    const { result } = withSetup(() => useGrowthReport())
    armStream()

    void result.generate(recentData())
    await nextTick()
    captured!.onChunk('第一版')
    captured!.onDone()
    await nextTick()

    void result.generate(recentData())
    await nextTick()
    expect(result.result.value).toBe('')
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
  })
})
