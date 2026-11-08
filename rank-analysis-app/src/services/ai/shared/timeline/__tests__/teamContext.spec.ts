import { describe, it, expect } from 'vitest'
import { buildTeamContext } from '../teamContext'
import { frame, input, pf } from './helpers'
import type { SlimEvent } from '../types'

const kill = (timestamp: number, victimId: number, killerId = 6): SlimEvent => ({
  type: 'CHAMPION_KILL',
  timestamp,
  killerId,
  victimId,
  assisting: [],
  x: 0,
  y: 0,
  bounty: 0,
  shutdownBounty: 0,
  damageReceived: []
})

describe('buildTeamContext lane diff', () => {
  it('is positive when ahead of the lane opponent at 14 minutes', () => {
    // 玩家 4（下路）对位玩家 9
    const ctx = buildTeamContext(
      input({
        frames: [frame(840000, [pf(4, { totalGold: 6000 }), pf(9, { totalGold: 5000 })])]
      })
    )
    expect(ctx[4].laneGoldDiff14).toBe(1000)
    expect(ctx[9].laneGoldDiff14).toBe(-1000)
  })

  it('falls back to the last frame at or before 14 minutes when none is near', () => {
    const ctx = buildTeamContext(
      input({
        frames: [
          frame(600000, [pf(4, { totalGold: 3000 }), pf(9, { totalGold: 3500 })]),
          frame(1200000, [pf(4, { totalGold: 9000 }), pf(9, { totalGold: 1 })])
        ]
      })
    )
    expect(ctx[4].laneGoldDiff14).toBe(-500)
  })

  it('is null with no frame at or before 14 minutes', () => {
    const ctx = buildTeamContext(input({ frames: [frame(1200000)] }))
    expect(ctx[4].laneGoldDiff14).toBeNull()
  })

  it('is null for everyone without lanes', () => {
    const ctx = buildTeamContext(
      input({ frames: [frame(840000, [pf(4, { totalGold: 6000 })])] }, { hasLanes: false })
    )
    expect(Object.values(ctx).every(c => c.laneGoldDiff14 === null)).toBe(true)
  })
})

describe('buildTeamContext deaths after teammates down', () => {
  it('counts a death with 2 teammates down within 30s (same instant included)', () => {
    const ctx = buildTeamContext(
      input({ events: [kill(100000, 1), kill(110000, 2), kill(120000, 4)] })
    )
    expect(ctx[4]).toMatchObject({ deaths: 1, deathsAfterTeammatesDown: 1 })
    const same = buildTeamContext(
      input({ events: [kill(100000, 1), kill(120000, 2), kill(120000, 4)] })
    )
    expect(same[4].deathsAfterTeammatesDown).toBe(1)
  })

  it('does not count when only 1 teammate is down', () => {
    const ctx = buildTeamContext(input({ events: [kill(110000, 2), kill(120000, 4)] }))
    expect(ctx[4]).toMatchObject({ deaths: 1, deathsAfterTeammatesDown: 0 })
  })

  it('does not count a teammate who died 31s earlier', () => {
    const ctx = buildTeamContext(
      input({ events: [kill(89000, 1), kill(110000, 2), kill(120000, 4)] })
    )
    expect(ctx[4].deathsAfterTeammatesDown).toBe(0)
  })

  it('ignores enemy deaths and the player own earlier death', () => {
    const ctx = buildTeamContext(
      input({ events: [kill(100000, 6, 1), kill(105000, 7, 1), kill(110000, 4), kill(120000, 4)] })
    )
    expect(ctx[4]).toMatchObject({ deaths: 2, deathsAfterTeammatesDown: 0 })
  })
})
