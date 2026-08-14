import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { withSetup } from '@renderer/test-utils/withSetup'
import { useBpDecision } from '../useBpDecision'
import type { BpDecision } from '@renderer/types/bpDecision'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

function decision(overrides: Partial<BpDecision> = {}): BpDecision {
  return {
    action_type: 'Pick',
    target: {
      champion_id: 64,
      lock: true,
      origin: { type: 'Fallback', pool_size: 3 },
      evidence: null
    },
    rejected: [],
    mode: 'Advisory',
    time_left_secs: 20,
    execute_at_secs_left: 5,
    user_overridden: false,
    is_in_progress: true,
    ...overrides
  }
}

describe('useBpDecision', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(null)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('选人期才轮询，离开后停止', async () => {
    const phase = ref('ChampSelect')
    const [, app] = withSetup(() => useBpDecision(phase))

    await vi.advanceTimersByTimeAsync(1100)
    const callsInChampSelect = invokeMock.mock.calls.length
    expect(callsInChampSelect).toBeGreaterThan(0)

    phase.value = 'InProgress'
    await nextTick()
    invokeMock.mockClear()
    await vi.advanceTimersByTimeAsync(3000)
    expect(invokeMock).not.toHaveBeenCalled()

    app.unmount()
  })

  it('卸载后不再轮询', async () => {
    const phase = ref('ChampSelect')
    const [, app] = withSetup(() => useBpDecision(phase))
    await vi.advanceTimersByTimeAsync(1100)
    app.unmount()
    invokeMock.mockClear()
    await vi.advanceTimersByTimeAsync(3000)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('倒计时本地插值，不出现负数', async () => {
    invokeMock.mockResolvedValue(decision({ time_left_secs: 1 }))
    const phase = ref('ChampSelect')
    const [result, app] = withSetup(() => useBpDecision(phase))

    await vi.advanceTimersByTimeAsync(1000)
    expect(result.decision.value).not.toBeNull()

    // 后续轮询全部失败 → catch 保留旧帧（decision 仍非 null），
    // 本地时钟继续走，elapsed 远超 baseSecs，displaySecs 靠 Math.max 钳在 0
    invokeMock.mockImplementation(() => Promise.reject(new Error('lcu down')))
    await vi.advanceTimersByTimeAsync(5000)
    expect(result.decision.value).not.toBeNull()
    expect(result.displaySecs.value).toBe(0)

    app.unmount()
  })

  it('显示距离自动执行的时间，而不是阶段剩余时间', async () => {
    invokeMock.mockResolvedValue(decision({ time_left_secs: 20, execute_at_secs_left: 5 }))
    const phase = ref('ChampSelect')
    const [result, app] = withSetup(() => useBpDecision(phase))

    await vi.advanceTimersByTimeAsync(100)
    expect(result.displaySecs.value).toBeGreaterThan(14.8)
    expect(result.displaySecs.value).toBeLessThanOrEqual(15)

    app.unmount()
  })

  it('重复读取同一后端快照时不重置插值基准', async () => {
    invokeMock.mockResolvedValue(decision({ time_left_secs: 20, execute_at_secs_left: 5 }))
    const phase = ref('ChampSelect')
    const [result, app] = withSetup(() => useBpDecision(phase))

    await vi.advanceTimersByTimeAsync(2100)
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(result.displaySecs.value).toBeLessThan(13.1)

    app.unmount()
  })

  it('阶段切换时决策归零', async () => {
    invokeMock.mockResolvedValue(decision())
    const phase = ref('ChampSelect')
    const [result, app] = withSetup(() => useBpDecision(phase))
    await vi.advanceTimersByTimeAsync(1100)
    expect(result.decision.value).not.toBeNull()

    phase.value = 'InProgress'
    await nextTick()
    expect(result.decision.value).toBeNull()
    expect(result.displaySecs.value).toBe(0)

    app.unmount()
  })
})
