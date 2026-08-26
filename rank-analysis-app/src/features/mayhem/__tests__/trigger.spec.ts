/**
 * 大乱斗助手触发调度器单测：阶段过滤、活跃度判定与启停生命周期。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ACTIVE_SLOTS_REQUIRED,
  BAND_ACTIVE_THRESHOLD,
  createAssistScheduler,
  type BandStatsDto
} from '../trigger'

function band(slot: number, stddev: number): BandStatsDto {
  return { slot, rect: { x: 0, y: 0, w: 100, h: 20 }, stddev }
}

describe('assist scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('非对局阶段直接短路，不请求截屏', async () => {
    const getBandStats = vi.fn().mockResolvedValue([band(0, 60), band(1, 60), band(2, 5)])
    const s = createAssistScheduler({ getPhase: () => Promise.resolve('Lobby'), getBandStats })
    const tick = await s.tick()
    expect(tick.note).toContain('非对局中')
    expect(tick.detected).toBe(false)
    expect(getBandStats).not.toHaveBeenCalled()
  })

  it('两条以上活跃带判定为三选一画面', async () => {
    const stats = [
      band(0, BAND_ACTIVE_THRESHOLD + 10),
      band(1, BAND_ACTIVE_THRESHOLD + 1),
      band(2, 3)
    ]
    const s = createAssistScheduler({
      getPhase: () => Promise.resolve('InProgress'),
      getBandStats: () => Promise.resolve(stats)
    })
    const tick = await s.tick()
    expect(tick.activeSlots).toBe(ACTIVE_SLOTS_REQUIRED)
    expect(tick.detected).toBe(true)
    expect(tick.maxStddev).toBe(BAND_ACTIVE_THRESHOLD + 10)
  })

  it('onDetected 仅在检测沿触发一次，冷却期内不重复', async () => {
    vi.useFakeTimers()
    try {
      const onDetected = vi.fn().mockResolvedValue(undefined)
      const stats = [band(0, 60), band(1, 60), band(2, 60)]
      const s = createAssistScheduler(
        {
          getPhase: () => Promise.resolve('InProgress'),
          getBandStats: () => Promise.resolve(stats),
          onDetected,
          detectCooldownMs: 8_000
        },
        1_000
      )
      s.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(onDetected).toHaveBeenCalledTimes(1)

      // 冷却（8s）过后再触发一次
      await vi.advanceTimersByTimeAsync(7_000)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(onDetected).toHaveBeenCalledTimes(2)
      s.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('onDetected 失败时 note 标记推送失败且不中断 tick 链', async () => {
    const onDetected = vi.fn().mockRejectedValue(new Error('push down'))
    const s = createAssistScheduler({
      getPhase: () => Promise.resolve('InProgress'),
      getBandStats: () => Promise.resolve([band(0, 60), band(1, 60), band(2, 5)]),
      onDetected
    })
    const t1 = await s.tick()
    expect(t1.note).toContain('推送失败')
    // 冷却期内不再触发
    const t2 = await s.tick()
    expect(t2.note).not.toContain('推送失败')
    expect(t2.detected).toBe(true)
    expect(onDetected).toHaveBeenCalledTimes(1)
  })

  it('截屏不可用时给出明确 note 而不抛错', async () => {
    const s = createAssistScheduler({
      getPhase: () => Promise.resolve('InProgress'),
      getBandStats: () => Promise.resolve(null)
    })
    const tick = await s.tick()
    expect(tick.note).toBe('截屏不可用')
    expect(tick.detected).toBe(false)
  })

  it('tick 异常被吞成失败快照，调度器继续存活', async () => {
    let calls = 0
    const s = createAssistScheduler({
      getPhase: () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('lcu down')) : Promise.resolve('InProgress')
      },
      getBandStats: () => Promise.resolve([])
    })
    const tick = await s.tick()
    expect(tick.note).toContain('tick 失败')

    // 恢复后下一轮正常（空 stats 视为截屏不可用）
    const ok = await s.tick()
    expect(ok.note).toBe('截屏不可用')
  })

  it('start/stop 控制定时器，start 立即执行一轮', async () => {
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const s = createAssistScheduler({ getPhase, getBandStats: () => Promise.resolve([]) }, 5_000)
    s.start()
    expect(s.running).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(getPhase).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(getPhase).toHaveBeenCalledTimes(2)

    s.stop()
    expect(s.running).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getPhase).toHaveBeenCalledTimes(2)
    // 幂等 stop
    s.stop()
  })
})
