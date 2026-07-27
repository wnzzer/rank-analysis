/**
 * useGamingAIAnalysis 单元测试
 *
 * 回归重点：**面板显隐必须与请求生命周期解耦**。
 *
 * 旧实现里 `showAIResult = true` 只出现在发起新请求的那一处，于是关掉面板 =
 * 永久失去查看入口，直到那次请求自己结束；而按钮又绑了 `:loading`
 * （naive-ui Button 在 loading 时根本不 emit click），加上 `if (aiLoading) return`
 * 早退门，三道锁一起把用户挡在外面。请求结束后再点，又会清空 `aiResult`
 * 从头重跑，把已经流完的结果和一次 API 调用一起丢掉。
 *
 * @module composables/useGamingAIAnalysis
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, reactive, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { StreamCallbacks } from '@renderer/services/ai'

const messageStub = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('naive-ui', () => ({ useMessage: () => messageStub }))
vi.mock('@renderer/services/ai', () => ({
  analyzeGameWithAIStream: vi.fn(),
  analyzeChampSelectWithAIStream: vi.fn()
}))

import { analyzeGameWithAIStream, analyzeChampSelectWithAIStream } from '@renderer/services/ai'
import { useGamingAIAnalysis } from './useGamingAIAnalysis'

const mockTeam = vi.mocked(analyzeGameWithAIStream)
const mockChampSelect = vi.mocked(analyzeChampSelectWithAIStream)

/** 捕获流式回调，让测试自己驱动 chunk/done/error 的时机 */
let captured: StreamCallbacks | null = null
function armStream(mock: { mockImplementation: (fn: (...a: any[]) => any) => void }): void {
  mock.mockImplementation((...args: any[]) => {
    captured = args.find(a => a && typeof a.onChunk === 'function') as StreamCallbacks
    // 永不自己 settle：由测试调用 captured.onDone()/onError() 决定
    return new Promise<void>(() => {})
  })
}

/** 在组件上下文里跑 composable */
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
  const sessionData = reactive({ phase }) as any
  const opggMode = ref('ranked' as const)
  return withSetup(() => useGamingAIAnalysis(sessionData, opggMode))
}

describe('useGamingAIAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured = null
    armStream(mockTeam)
    armStream(mockChampSelect)
  })

  it('首次打开：开面板并发起一次分析', async () => {
    const { result, unmount } = setup()

    result.openPanel()
    await nextTick()

    expect(result.showPanel.value).toBe(true)
    expect(result.loading.value).toBe(true)
    expect(mockTeam).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('分析中关掉面板后再点按钮：面板重开，不发起第二次请求', async () => {
    const { result, unmount } = setup()
    result.openPanel()
    await nextTick()

    result.showPanel.value = false // 用户点遮罩/Esc 关掉
    await nextTick()

    result.openPanel()
    await nextTick()

    expect(result.showPanel.value).toBe(true)
    expect(result.loading.value).toBe(true)
    expect(mockTeam).toHaveBeenCalledTimes(1) // 关键：没有白跑第二次
    unmount()
  })

  it('分析完成后关掉面板再点按钮：结果还在，不重跑', async () => {
    const { result, unmount } = setup()
    result.openPanel()
    await nextTick()

    captured!.onChunk('## 结论\n打野节奏偏慢')
    captured!.onDone()
    await nextTick()
    expect(result.loading.value).toBe(false)

    result.showPanel.value = false
    await nextTick()
    result.openPanel()
    await nextTick()

    expect(result.showPanel.value).toBe(true)
    expect(result.result.value).toContain('打野节奏偏慢')
    expect(mockTeam).toHaveBeenCalledTimes(1) // 关键：不白烧一次 API 调用
    unmount()
  })

  it('「重新分析」显式重跑：清空旧结果并再发一次', async () => {
    const { result, unmount } = setup()
    result.openPanel()
    await nextTick()
    captured!.onChunk('旧结果')
    captured!.onDone()
    await nextTick()

    void result.rerun()
    await nextTick()

    expect(result.result.value).toBe('')
    expect(result.loading.value).toBe(true)
    expect(mockTeam).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('出错后 loading 复位，且下次点击可以重新发起', async () => {
    const { result, unmount } = setup()
    result.openPanel()
    await nextTick()

    captured!.onError('boom')
    await nextTick()
    expect(result.loading.value).toBe(false)
    expect(messageStub.error).toHaveBeenCalled()

    result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(2) // 没有结果，视为可重新发起
    unmount()
  })

  it('选人期走阵容分析，对局中走整队分析', async () => {
    const inGame = setup('InProgress')
    inGame.result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(1)
    expect(mockChampSelect).not.toHaveBeenCalled()
    inGame.unmount()

    vi.clearAllMocks()
    armStream(mockTeam)
    armStream(mockChampSelect)

    const champSelect = setup('ChampSelect')
    champSelect.result.openPanel()
    await nextTick()
    expect(mockChampSelect).toHaveBeenCalledTimes(1)
    expect(mockTeam).not.toHaveBeenCalled()
    champSelect.unmount()
  })

  it('面板标题随阶段切换', () => {
    const inGame = setup('InProgress')
    expect(inGame.result.panelTitle.value).toBe('AI 分析')
    inGame.unmount()

    const champSelect = setup('ChampSelect')
    expect(champSelect.result.panelTitle.value).toBe('选人期阵容分析')
    champSelect.unmount()
  })
})
