/**
 * useMatchReplay 单元测试
 *
 * 重点覆盖三个实测得出的坑（见 2026-07-27 回放设计文档）：
 * 无效对局永远停在未就绪态 → 必须超时兜底；已下载的回放无需前置判断；
 * 不可用时不应发出任何请求。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const messageError = vi.fn()
const messageSuccess = vi.fn()
vi.mock('naive-ui', () => ({
  useMessage: () => ({ error: messageError, success: messageSuccess })
}))

import { invoke } from '@tauri-apps/api/core'
import { useMatchReplay } from './useMatchReplay'
import type { Game } from '@renderer/types/domain/match'

const mockInvoke = vi.mocked(invoke)

/** 只填测试用得到的字段，其余交给类型断言 */
function makeGame(gameId = 300934069971): Game {
  return { gameId } as Game
}

/** 让 watch(immediate) 触发的可用性查询跑完 */
async function settle() {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useMatchReplay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockInvoke.mockReset()
    messageError.mockReset()
    messageSuccess.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('打开详情页只查可用性，不产生任何副作用请求', async () => {
    mockInvoke.mockResolvedValue({ playable: true, reason: null })

    const { canPlay } = useMatchReplay(ref(makeGame()))
    await settle()

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('get_replay_availability', {
      gameId: 300934069971
    })
    // 关键：预判阶段绝不能触发下载，否则打开详情页就会开始下回放
    expect(mockInvoke).not.toHaveBeenCalledWith('start_replay_download', expect.anything())
    expect(canPlay.value).toBe(true)
  })

  it('不可用时按钮禁用并给出原因', async () => {
    mockInvoke.mockResolvedValue({
      playable: false,
      reason: '该对局为 16.13 版本，当前客户端为 16.14，无法观看回放'
    })

    const { canPlay, disabledReason } = useMatchReplay(ref(makeGame()))
    await settle()

    expect(canPlay.value).toBe(false)
    expect(disabledReason.value).toContain('16.13')
  })

  it('已就绪时下载后立刻拉起观看', async () => {
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_replay_availability') return { playable: true, reason: null }
      if (cmd === 'is_replay_ready') return true
      return undefined
    })

    const { play } = useMatchReplay(ref(makeGame()))
    await settle()

    await play()

    const commands = mockInvoke.mock.calls.map(c => c[0])
    expect(commands).toContain('start_replay_download')
    expect(commands).toContain('watch_replay')
    expect(messageError).not.toHaveBeenCalled()
  })

  it('迟迟不就绪时轮询到超时并报错，且不拉起客户端', async () => {
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_replay_availability') return { playable: true, reason: null }
      // 模拟无效对局：永远停在未就绪（实测 LCU 会一直停在 checking）
      if (cmd === 'is_replay_ready') return false
      return undefined
    })

    const { play, busy } = useMatchReplay(ref(makeGame()))
    await settle()

    const pending = play()
    // 推进超过 60s 轮询窗口
    await vi.advanceTimersByTimeAsync(61_000)
    await pending

    expect(messageError).toHaveBeenCalledWith('未能获取该对局回放，可能已过期或不可用')
    expect(mockInvoke).not.toHaveBeenCalledWith('watch_replay', expect.anything())
    expect(busy.value).toBe(false)
  })

  it('单次状态查询失败不终止轮询', async () => {
    let readyCalls = 0
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_replay_availability') return { playable: true, reason: null }
      if (cmd === 'is_replay_ready') {
        readyCalls += 1
        // LCU 在对局刚结束等时刻会瞬时拒绝请求，第一次失败必须能恢复
        if (readyCalls === 1) throw new Error('请求失败或认证失效')
        return true
      }
      return undefined
    })

    const { play } = useMatchReplay(ref(makeGame()))
    await settle()

    const pending = play()
    await vi.advanceTimersByTimeAsync(2_000)
    await pending

    expect(readyCalls).toBeGreaterThan(1)
    expect(mockInvoke.mock.calls.map(c => c[0])).toContain('watch_replay')
  })

  it('预判查询失败时退化为可点，而不是让按钮永久禁用', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'))

    const { canPlay } = useMatchReplay(ref(makeGame()))
    await settle()

    expect(canPlay.value).toBe(true)
  })
})
