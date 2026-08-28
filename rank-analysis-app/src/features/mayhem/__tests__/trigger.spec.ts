import { describe, expect, it, vi } from 'vitest'
import {
  createAssistScheduler,
  MAYHEM_AUGMENT_TARGET_LEVELS,
  type BandStatsDto,
  type LivePlayerStateDto
} from '../trigger'

describe('AssistScheduler - Smart Level-Driven Augment State Machine', () => {
  it('has correct 4 augment target levels', () => {
    expect(MAYHEM_AUGMENT_TARGET_LEVELS).toEqual([3, 7, 11, 15])
  })

  it('stays in idle_sleep without capturing screen when level is below target', async () => {
    const getBandStats = vi.fn().mockResolvedValue([])
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi.fn().mockResolvedValue({ inGame: true, level: 2 } as LivePlayerStateDto)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats
    })

    const tick = await scheduler.tick()
    expect(tick.mode).toBe('idle_sleep')
    expect(tick.currentRound).toBe(1)
    expect(tick.level).toBe(2)
    expect(tick.detected).toBe(false)
    // In idle sleep below target level, screen capture must NOT be called (0% CPU)
    expect(getBandStats).not.toHaveBeenCalled()
  })

  it('wakes up to burst_detecting and captures cards when level reaches 3', async () => {
    const bandStats: BandStatsDto[] = [
      { slot: 0, rect: { x: 0, y: 0, w: 100, h: 20 }, stddev: 25 },
      { slot: 1, rect: { x: 100, y: 0, w: 100, h: 20 }, stddev: 30 },
      { slot: 2, rect: { x: 200, y: 0, w: 100, h: 20 }, stddev: 22 }
    ]
    const getBandStats = vi.fn().mockResolvedValue(bandStats)
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    const getLivePlayer = vi.fn().mockResolvedValue({ inGame: true, level: 3 } as LivePlayerStateDto)
    const onDetected = vi.fn().mockResolvedValue(undefined)

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats,
      onDetected
    })

    // First tick: reaches level 3 -> transitions to burst and captures cards
    const tick = await scheduler.tick()
    expect(tick.mode).toBe('pushed_waiting_choice')
    expect(tick.detected).toBe(true)
    expect(tick.currentRound).toBe(1)
    expect(onDetected).toHaveBeenCalledTimes(1)
    expect(getBandStats).toHaveBeenCalledTimes(1)
  })

  it('advances to round 2 and returns to sleep when cards disappear after selection', async () => {
    const activeBandStats: BandStatsDto[] = [
      { slot: 0, rect: { x: 0, y: 0, w: 100, h: 20 }, stddev: 25 },
      { slot: 1, rect: { x: 100, y: 0, w: 100, h: 20 }, stddev: 30 },
      { slot: 2, rect: { x: 200, y: 0, w: 100, h: 20 }, stddev: 22 }
    ]
    const emptyBandStats: BandStatsDto[] = [
      { slot: 0, rect: { x: 0, y: 0, w: 100, h: 20 }, stddev: 2 },
      { slot: 1, rect: { x: 100, y: 0, w: 100, h: 20 }, stddev: 1 },
      { slot: 2, rect: { x: 200, y: 0, w: 100, h: 20 }, stddev: 3 }
    ]

    let currentStats = activeBandStats
    const getBandStats = vi.fn().mockImplementation(() => Promise.resolve(currentStats))
    const getPhase = vi.fn().mockResolvedValue('InProgress')
    let currentLevel = 3
    const getLivePlayer = vi.fn().mockImplementation(() =>
      Promise.resolve({ inGame: true, level: currentLevel } as LivePlayerStateDto)
    )

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats
    })

    // Tick 1: detects cards at Lv 3
    const tick1 = await scheduler.tick()
    expect(tick1.mode).toBe('pushed_waiting_choice')
    expect(tick1.currentRound).toBe(1)

    // Player selects augment -> cards disappear
    currentStats = emptyBandStats
    const tick2 = await scheduler.tick()
    expect(tick2.mode).toBe('idle_sleep')
    expect(tick2.currentRound).toBe(2)
    expect(tick2.note).toContain('第 1 轮选择完毕')

    // Tick 3: player is at Lv 5 (below round 2 target Lv 7) -> stays in sleep, 0 screen capture
    currentLevel = 5
    getBandStats.mockClear()
    const tick3 = await scheduler.tick()
    expect(tick3.mode).toBe('idle_sleep')
    expect(tick3.currentRound).toBe(2)
    expect(getBandStats).not.toHaveBeenCalled()
  })

  it('resets state machine to round 1 when leaving InProgress', async () => {
    let phase = 'InProgress'
    const getPhase = vi.fn().mockImplementation(() => Promise.resolve(phase))
    const getLivePlayer = vi.fn().mockResolvedValue({ inGame: true, level: 12 } as LivePlayerStateDto)
    const getBandStats = vi.fn().mockResolvedValue([])

    const scheduler = createAssistScheduler({
      getPhase,
      getLivePlayer,
      getBandStats
    })

    await scheduler.tick()

    // Match ends
    phase = 'EndOfGame'
    const tickEnd = await scheduler.tick()
    expect(tickEnd.mode).toBe('idle_sleep')
    expect(tickEnd.currentRound).toBe(1)
    expect(tickEnd.note).toContain('非对局中')
  })
})
