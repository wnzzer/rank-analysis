/**
 * useGamingAIAnalysis 单元测试
 *
 * 回归重点：**面板显隐必须与请求生命周期解耦**（旧实现三道锁把用户挡在面板外）。
 * D-P2 追加回归：
 * - champSelect / game 两个 kind 各自独立进度，切阶段不丢；
 * - 自动发起 3 分钟限流（关窗重开不反复烧 token），rerun 与 phase 切换不受限流约束。
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
const captured: { team: StreamCallbacks | null; champSelect: StreamCallbacks | null } = {
  team: null,
  champSelect: null
}
function armStream(
  mock: { mockImplementation: (fn: (...a: any[]) => any) => void },
  kind: 'team' | 'champSelect'
): void {
  mock.mockImplementation((...args: any[]) => {
    captured[kind] = args.find(a => a && typeof a.onChunk === 'function') as StreamCallbacks
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
    captured.team = null
    captured.champSelect = null
    armStream(mockTeam, 'team')
    armStream(mockChampSelect, 'champSelect')
    // 每个用例独立时间线，限流台账从 0 重新开始
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))
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

    captured.team!.onChunk('## 结论\n打野节奏偏慢')
    captured.team!.onDone()
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

  it('「重新分析」显式重跑：清空旧结果并再发一次（不受限流约束）', async () => {
    const { result, unmount } = setup()
    result.openPanel()
    await nextTick()
    captured.team!.onChunk('旧结果')
    captured.team!.onDone()
    await nextTick()

    void result.rerun()
    await nextTick()

    expect(result.result.value).toBe('')
    expect(result.loading.value).toBe(true)
    expect(mockTeam).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('出错后 loading 复位；自动重开被限流拦下，显式 re-run 立即可用', async () => {
    const { result, unmount } = setup()
    result.openPanel()
    await nextTick()

    captured.team!.onError('boom')
    await nextTick()
    expect(result.loading.value).toBe(false)
    expect(messageStub.error).toHaveBeenCalled()

    // 3 分钟内自动重开：面板打开但不发起（防烧 token）
    result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(1)

    // 显式「重新分析」不受限流
    void result.rerun()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(2)
    expect(result.loading.value).toBe(true)
    unmount()
  })

  it('自动发起限流：3 分钟内第二次自动打开不重复发起，超窗后恢复', async () => {
    const { result, unmount } = setup()
    result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(1)
    captured.team!.onDone()
    await nextTick()

    // 结果为空（如 error 后被清空）场景下模拟：直接清空结果模拟"没东西可看"
    result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(1) // 限流中

    // 推进 3 分 1 秒 → 自动发起恢复
    vi.setSystemTime(new Date(2026, 0, 1, 12, 3, 1))
    result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('phase 切换重置限流台账：新阶段自动发起不受旧阶段限流影响', async () => {
    const sessionData = reactive({ phase: 'InProgress' }) as any
    const opggMode = ref('ranked' as const)
    const { result, unmount } = withSetup(() => useGamingAIAnalysis(sessionData, opggMode))

    result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(1)

    // 同 phase 再开：限流
    result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(1)

    // InProgress → ChampSelect（新阶段）：切换到 champSelect kind，自动发起不被 game 的旧台账拦
    sessionData.phase = 'ChampSelect'
    await nextTick()
    result.openPanel()
    await nextTick()
    expect(mockChampSelect).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('选人期走阵容分析，对局中走整队分析，各自进度互不干扰', async () => {
    const inGame = setup('InProgress')
    inGame.result.openPanel()
    await nextTick()
    expect(mockTeam).toHaveBeenCalledTimes(1)
    expect(mockChampSelect).not.toHaveBeenCalled()
    inGame.unmount()

    vi.clearAllMocks()
    armStream(mockTeam, 'team')
    armStream(mockChampSelect, 'champSelect')

    const champSelect = setup('ChampSelect')
    champSelect.result.openPanel()
    await nextTick()
    expect(mockChampSelect).toHaveBeenCalledTimes(1)
    expect(mockTeam).not.toHaveBeenCalled()
    champSelect.unmount()
  })

  it('kind 状态隔离：切阶段后另一 kind 的结果/进度保留', async () => {
    const sessionData = reactive({ phase: 'ChampSelect' }) as any
    const opggMode = ref('ranked' as const)
    const { result, unmount } = withSetup(() => useGamingAIAnalysis(sessionData, opggMode))

    result.openPanel()
    await nextTick()
    captured.champSelect!.onChunk('选人期分析中...')

    // 进对局：champSelect 的进度还在，game 是全新的空进度
    sessionData.phase = 'InProgress'
    await nextTick()
    expect(result.activeKind.value).toBe('game')
    expect(result.result.value).toBe('')
    expect(result.kindState.champSelect.result.value).toContain('选人期分析中')
    expect(result.kindState.champSelect.loading.value).toBe(true)
    expect(result.kindState.game.loading.value).toBe(false)
    unmount()
  })

  it('面板标题随阶段切换', () => {
    const inGame = setup('InProgress')
    expect(inGame.result.panelTitle.value).toBe('AI 分析')
    inGame.unmount()

    const champSelect = setup('ChampSelect')
    expect(champSelect.result.panelTitle.value).toBe('选人期阵容分析')
    champSelect.unmount()
  })

  it('rerunKind：指定 kind 重跑，不碰另一个 kind 的进度（三 tab 化的重跑分发）', async () => {
    const sessionData = reactive({ phase: 'InProgress' }) as any
    const opggMode = ref('ranked' as const)
    const { result, unmount } = withSetup(() => useGamingAIAnalysis(sessionData, opggMode))

    result.openPanel()
    await nextTick()
    captured.team!.onChunk('赛后分析中...')
    captured.team!.onDone()
    await nextTick()

    // 对局中阶段显式重跑选人期 kind：只动 champSelect 的进度
    void result.rerunKind('champSelect')
    await nextTick()
    expect(mockChampSelect).toHaveBeenCalledTimes(1)
    expect(result.kindState.champSelect.loading.value).toBe(true)
    // game（赛后）的进度原样保留
    expect(result.kindState.game.result.value).toContain('赛后分析中')
    expect(mockTeam).toHaveBeenCalledTimes(1)
    unmount()
  })
})
