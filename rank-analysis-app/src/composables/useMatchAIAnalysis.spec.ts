/**
 * useMatchAIAnalysis 单元测试（复盘标签页版）
 *
 * 回归重点：
 * - 整局点评自动生成但不重复烧 API：同一目标在飞/已有结果时 ensureOverview 不重跑；
 * - 单人点评按需：换目标立即重新分析，即便整局还在飞——旧请求迟到的 chunk 必须被代次作废；
 * - 显式重跑清空旧结果；换对局复位 loading（否则按钮永远转圈）；
 * - 时间线不可用时点评顶部有降级提示。
 *
 * @module composables/useMatchAIAnalysis
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { Game } from '@renderer/types/domain/match'

const messageStub = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('naive-ui', () => ({ useMessage: () => messageStub }))
vi.mock('@renderer/services/ai', () => ({ analyzeMatchDetailWithAIStream: vi.fn() }))
vi.mock('@renderer/services/ai/shared/recentProfile.batch', () => ({
  fetchBatchProfiles: vi.fn(() => Promise.resolve(new Map())),
  injectNoteBriefs: vi.fn((m: unknown) => m)
}))

import { analyzeMatchDetailWithAIStream } from '@renderer/services/ai'
import { useMatchAIAnalysis } from './useMatchAIAnalysis'

const mockAnalyze = vi.mocked(analyzeMatchDetailWithAIStream)

type Callbacks = { onChunk: (c: string) => void; onDone: () => void; onError: (e: string) => void }
type Extras = { onTimelineStatus?: (s: 'ok' | 'disabled' | 'unavailable') => void }

/** 每次调用捕获的流式回调与 extras，由测试驱动 chunk/done/error 的时机 */
let calls: Array<{ cb: Callbacks; extras: Extras }> = []
function armStream(): void {
  mockAnalyze.mockImplementation((...args: unknown[]) => {
    calls.push({ cb: args[1] as Callbacks, extras: (args[3] ?? {}) as Extras })
    return new Promise<void>(() => {}) // 永不自己 settle
  })
}

const GAME = {
  gameId: 1,
  participantIdentities: [{ participantId: 1, player: { puuid: 'p1' } }],
  participants: [{ participantId: 1, championId: 10, teamPosition: 'TOP' }]
} as unknown as Game

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

const setup = () => withSetup(() => useMatchAIAnalysis(ref(GAME)))

/** 让 ensureProfiles 的 await 链走完 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('useMatchAIAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls = []
    armStream()
  })

  it('ensureOverview 首次调用：发起一次整局分析', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    expect(result.aiMode.value).toBe('overview')
    expect(result.aiLoading.value).toBe(true)
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('整局在飞时再次 ensureOverview（切走再切回标签）：不发第二次', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    void result.ensureOverview()
    await flush()
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('整局完成后再 ensureOverview：结果还在，不重跑', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    calls[0].cb.onChunk('## 结论\n下路对线崩了')
    calls[0].cb.onDone()
    await nextTick()

    void result.ensureOverview()
    await flush()
    expect(result.aiResult.value).toContain('下路对线崩了')
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('requestPlayer：换目标即重新分析（单人模式 + participantId）', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    calls[0].cb.onChunk('整局内容')
    calls[0].cb.onDone()
    await nextTick()

    void result.requestPlayer(3)
    await flush()
    expect(result.aiMode.value).toBe('player')
    expect(result.aiTargetParticipantId.value).toBe(3)
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
    expect(mockAnalyze.mock.calls[1][2]).toEqual({ mode: 'player', participantId: 3 })
    expect(result.aiResult.value).toBe('')
    unmount()
  })

  it('整局还在飞时 requestPlayer：立即开新请求，旧请求迟到的 chunk 被作废', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    void result.requestPlayer(3)
    await flush()
    expect(mockAnalyze).toHaveBeenCalledTimes(2)

    calls[0].cb.onChunk('整局迟到的内容')
    calls[1].cb.onChunk('单人内容')
    await nextTick()
    expect(result.aiResult.value).toBe('单人内容')
    unmount()
  })

  it('同一玩家重复 requestPlayer：不重跑', async () => {
    const { result, unmount } = setup()
    void result.requestPlayer(3)
    await flush()
    void result.requestPlayer(3)
    await flush()
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('runCurrentAiAnalysis 是显式重跑：清空旧结果并再发一次', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    calls[0].cb.onChunk('旧结果')
    calls[0].cb.onDone()
    await nextTick()

    void result.runCurrentAiAnalysis()
    await flush()
    expect(result.aiResult.value).toBe('')
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('时间线不可用：渲染结果顶部带降级提示', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    calls[0].extras.onTimelineStatus?.('unavailable')
    calls[0].cb.onChunk('点评正文')
    await nextTick()
    expect(result.aiTimelineStatus.value).toBe('unavailable')
    expect(result.renderedAiResult.value).toContain('本局时间线不可用')
    unmount()
  })

  it('resetOnGameChange 复位 loading、结果与目标', async () => {
    const { result, unmount } = setup()
    void result.requestPlayer(3)
    await flush()
    expect(result.aiLoading.value).toBe(true)

    result.resetOnGameChange()
    expect(result.aiLoading.value).toBe(false)
    expect(result.aiResult.value).toBe('')
    expect(result.aiMode.value).toBe('overview')
    expect(result.aiTargetParticipantId.value).toBeNull()
    unmount()
  })

  it('生成失败：aiError 记录原因并体现在 aiStateLabel；重跑时清空', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    calls[0].cb.onError('额度不足')
    await nextTick()
    expect(result.aiState.value).toBe('error')
    expect(result.aiError.value).toBe('额度不足')
    expect(result.aiStateLabel.value).toContain('额度不足')

    void result.runCurrentAiAnalysis()
    await flush()
    expect(result.aiError.value).toBeNull()
    expect(result.aiStateLabel.value).not.toContain('额度不足')
    unmount()
  })

  it('整局生成失败后 ensureOverview 不自动重试；显式重跑才重试', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    calls[0].cb.onError('额度不足')
    await nextTick()

    void result.ensureOverview()
    await flush()
    expect(mockAnalyze).toHaveBeenCalledTimes(1)

    void result.runCurrentAiAnalysis()
    await flush()
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('resetOnGameChange 清空时间线状态、卡片、归因与材料数字', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    calls[0].extras.onTimelineStatus?.('unavailable')
    ;(calls[0].extras as any).onTimelineCards?.([{ id: 'D1' }])
    ;(calls[0].extras as any).onAttribution?.({ verdicts: [] })
    ;(calls[0].extras as any).onStage2Material?.(new Set([1]))
    ;(calls[0].extras as any).onEntityFacts?.({ players: [] })
    expect(result.aiTimelineStatus.value).toBe('unavailable')

    result.resetOnGameChange()
    expect(result.aiTimelineStatus.value).toBeNull()
    expect(result.aiTimelineCards.value).toBeNull()
    expect(result.aiAttribution.value).toBeNull()
    expect(result.aiMaterialNumbers.value).toBeNull()
    expect(result.aiEntityFacts.value).toBeNull()
    unmount()
  })

  it('整局点评渲染同样过张冠李戴过滤（onEntityFacts 接线）', async () => {
    const { result, unmount } = setup()
    void result.ensureOverview()
    await flush()
    ;(calls[0].extras as any).onEntityFacts?.({
      players: [
        { participantId: 2, aliases: ['赵信'], stats: { gold: 9500 }, numbers: [9500] },
        { participantId: 7, aliases: ['男枪'], stats: { gold: 15000 }, numbers: [15000] }
      ]
    })
    calls[0].cb.onChunk('## 关键证据\n\n- 赵信：被打穿了。男枪只有 9500 金币。')
    await nextTick()
    expect(result.renderedAiResult.value).toContain('被打穿了')
    expect(result.renderedAiResult.value).not.toContain('只有')
    unmount()
  })
})
