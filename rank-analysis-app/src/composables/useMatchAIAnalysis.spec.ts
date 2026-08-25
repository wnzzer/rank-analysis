/**
 * useMatchAIAnalysis 单元测试
 *
 * 回归重点与对局页同源（见 {@link useGamingAIAnalysis} 的 spec）：**面板显隐必须
 * 与请求生命周期解耦**。旧实现里 `showAiModal = true` 只出现在 openOverviewAnalysis /
 * openPlayerAnalysis 这两个「顺带发起请求」的入口，且两者都走
 * `if (!g || aiLoading.value) return` 早退门；触发按钮又绑了 `:loading`
 * （naive-ui Button 在 loading 时不 emit click）。于是关掉面板 = 失去入口，
 * 直到那次请求自己结束。
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
import type { StreamCallbacks } from '@renderer/services/ai'

const mockAnalyze = vi.mocked(analyzeMatchDetailWithAIStream)

/** 捕获流式回调，由测试驱动 chunk/done/error 的时机 */
let captured: StreamCallbacks | null = null
function armStream(): void {
  mockAnalyze.mockImplementation((_game, callbacks) => {
    captured = callbacks
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
    captured = null
    armStream()
  })

  it('首次打开整局复盘：开面板并发起一次分析', async () => {
    const { result, unmount } = setup()

    result.openOverviewAnalysis(1)
    await flush()

    expect(result.showAiModal.value).toBe(true)
    expect(result.aiLoading.value).toBe(true)
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('发起分析时注入锐评词库样本（好+坏词库采样，非空字符串数组）', async () => {
    const { result, unmount } = setup()

    result.openOverviewAnalysis(1)
    await flush()

    const extras = mockAnalyze.mock.calls[0][3] as { vocabSamples?: string[] }
    expect(extras.vocabSamples).toBeDefined()
    expect(Array.isArray(extras.vocabSamples)).toBe(true)
    expect(extras.vocabSamples!.length).toBeGreaterThanOrEqual(30)
    expect(extras.vocabSamples!.every(w => typeof w === 'string' && w.length > 0)).toBe(true)
    unmount()
  })

  it('分析中关掉面板后再点触发按钮：面板重开，不发起第二次请求', async () => {
    const { result, unmount } = setup()
    result.openOverviewAnalysis(1)
    await flush()

    result.showAiModal.value = false // 用户关掉面板
    await nextTick()

    result.openOverviewAnalysis(1)
    await flush()

    expect(result.showAiModal.value).toBe(true)
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('分析完成后关掉面板再打开：结果还在，不重跑', async () => {
    const { result, unmount } = setup()
    result.openOverviewAnalysis(1)
    await flush()

    captured!.onChunk('## 结论\n下路对线崩了')
    captured!.onDone()
    await nextTick()

    result.showAiModal.value = false
    await nextTick()
    result.openOverviewAnalysis(1)
    await flush()

    expect(result.showAiModal.value).toBe(true)
    expect(result.aiResult.value).toContain('下路对线崩了')
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('切到单人复盘：目标变了要重新分析，不能沿用整局结果', async () => {
    const { result, unmount } = setup()
    result.openOverviewAnalysis(1)
    await flush()
    captured!.onChunk('整局内容')
    captured!.onDone()
    await nextTick()

    result.openPlayerAnalysis(1)
    await flush()

    expect(result.aiMode.value).toBe('player')
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('runCurrentAiAnalysis 是显式重跑：清空旧结果并再发一次', async () => {
    const { result, unmount } = setup()
    result.openOverviewAnalysis(1)
    await flush()
    captured!.onChunk('旧结果')
    captured!.onDone()
    await nextTick()

    void result.runCurrentAiAnalysis()
    await flush()

    expect(result.aiResult.value).toBe('')
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('resetOnGameChange 要把 aiLoading 一起复位，否则换对局后按钮永远转圈', async () => {
    const { result, unmount } = setup()
    result.openOverviewAnalysis(1)
    await flush()
    expect(result.aiLoading.value).toBe(true)

    result.resetOnGameChange(1)

    expect(result.aiLoading.value).toBe(false)
    expect(result.aiResult.value).toBe('')
    unmount()
  })
})
