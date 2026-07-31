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
    target: { champion_id: 64, lock: true, origin: { type: 'Fallback', pool_size: 3 }, evidence: null },
    rejected: [],
    mode: 'Advisory',
    time_left_secs: 20,
    execute_at_secs_left: 5,
    user_overridden: false,
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
    expect(result.displaySecs.value).toBeLessThanOrEqual(1)

    // 再走 5 秒但服务端没有新数据 → 插值到 0 后夹住
    invokeMock.mockResolvedValue(null)
    await vi.advanceTimersByTimeAsync(5000)
    expect(result.displaySecs.value).toBe(0)

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
