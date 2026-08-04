import { describe, expect, it } from 'vitest'
import { attackSpeedAtLevel, levelGrowthCurve, statAtLevel } from '../championStats'

describe('champion level scaling', () => {
  it('uses the League nonlinear growth curve and clamps levels', () => {
    expect(levelGrowthCurve(0)).toBe(0)
    expect(levelGrowthCurve(1)).toBe(0)
    expect(levelGrowthCurve(18)).toBe(17)
    expect(levelGrowthCurve(99)).toBe(17)
  })

  it('calculates ordinary stats at the selected level', () => {
    const stat = { base: 590, growth: 104 }
    expect(statAtLevel(stat, 1)).toBe(590)
    expect(statAtLevel(stat, 18)).toBe(2358)
  })

  it('uses attack-speed ratio rather than base speed for growth', () => {
    const attackSpeed = { base: 0.668, ratio: 0.625, growth: 2.2 }
    expect(attackSpeedAtLevel(attackSpeed, 1)).toBe(0.668)
    expect(attackSpeedAtLevel(attackSpeed, 18)).toBeCloseTo(0.90175, 8)
  })
})
