import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { useReconnectBanner } from './useReconnectBanner'
import { withSetup } from '../test-utils/withSetup'

describe('useReconnectBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(restoreMs = 3000) {
    const isConnected = ref(false)
    const [result, app] = withSetup(() => useReconnectBanner(isConnected, restoreMs))
    return { isConnected, reconnected: result.reconnected, unmount: () => app.unmount() }
  }

  it('lights up on false→true and falls back after restore window', async () => {
    const { isConnected, reconnected, unmount } = setup()
    isConnected.value = true
    await nextTick()
    expect(reconnected.value).toBe(true)
    vi.advanceTimersByTime(2999)
    expect(reconnected.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(reconnected.value).toBe(false)
    unmount()
  })

  it('does not trigger when connection stays true or stays false', async () => {
    const { isConnected, reconnected, unmount } = setup()
    isConnected.value = true
    await nextTick()
    expect(reconnected.value).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(reconnected.value).toBe(false)

    // 已连接状态下再次赋值 true（true→true）不应重新点亮
    isConnected.value = true
    await nextTick()
    expect(reconnected.value).toBe(false)

    // false→false 同样不触发
    isConnected.value = false
    await nextTick()
    expect(reconnected.value).toBe(false)
    unmount()
  })

  it('ignores initial connected state (undefined prev)', () => {
    const isConnected = ref(true)
    const [result, app] = withSetup(() => useReconnectBanner(isConnected))
    expect(result.reconnected.value).toBe(false)
    app.unmount()
  })

  it('re-arms the timer on repeated reconnects', async () => {
    const { isConnected, reconnected, unmount } = setup()
    // t=0 第一次重连：原计时器将在 t=3000 触发回落
    isConnected.value = true
    await nextTick()
    expect(reconnected.value).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(reconnected.value).toBe(true)
    // t=2000 断开再重连：若未重新武装计时器，t=3000 就会误回落；
    // 重置后应到 t=5000 才回落
    isConnected.value = false
    await nextTick()
    isConnected.value = true
    await nextTick()
    vi.advanceTimersByTime(2900)
    expect(reconnected.value).toBe(true)
    vi.advanceTimersByTime(100)
    expect(reconnected.value).toBe(false)
    unmount()
  })

  it('stops watching and clears pending timer after unmount', async () => {
    const { isConnected, reconnected, unmount } = setup()
    isConnected.value = true
    await nextTick()
    expect(reconnected.value).toBe(true)
    unmount()
    // 卸载后断连/重连不再被监听（watcher 已停），不会重新点亮、不会重新武装计时器：
    // 若 watcher 仍活跃，此处 false→true 会重新计时并在 3s 后回落为 false；
    // 停止后状态冻结在卸载时刻的残留值 true。
    isConnected.value = false
    await nextTick()
    isConnected.value = true
    await nextTick()
    vi.advanceTimersByTime(10_000)
    expect(reconnected.value).toBe(true)
  })
})
