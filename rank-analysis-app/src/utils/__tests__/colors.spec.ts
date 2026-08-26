import { describe, it, expect } from 'vitest'
import {
  kdaColor,
  killsColor,
  deathsColor,
  assistsColor,
  groupRateColor,
  healColorAndTaken,
  otherColor,
  winRateColor
} from '../colors'

describe('semantic stat colors', () => {
  it('kda: >=2.6 good / <=1.3 bad / else neutral', () => {
    expect(kdaColor(2.6)).toBe(kdaColor(3, true))
    expect(kdaColor(2.6)).not.toBe(kdaColor(2.59))
    expect(kdaColor(1.3)).toBe(kdaColor(0.5))
    expect(kdaColor(1.31)).toBe(kdaColor(2))
    // 三档互异且亮暗主题取色不同
    const dark = new Set([kdaColor(3), kdaColor(2), kdaColor(1)])
    expect(dark.size).toBe(3)
    expect(kdaColor(3, false)).not.toBe(kdaColor(3, true))
  })

  it('kills: >=8 good / <=3 bad', () => {
    expect(killsColor(8)).toBe(killsColor(10))
    expect(killsColor(3)).toBe(killsColor(0))
    expect(killsColor(4)).toBe(killsColor(7))
  })

  it('deaths: polarity inverted — >=8 bad / <=3 good', () => {
    expect(deathsColor(8)).toBe(deathsColor(12))
    expect(deathsColor(3)).toBe(deathsColor(1))
    expect(deathsColor(4)).toBe(deathsColor(7))
  })

  it('assists: >=10 good / <=3 bad', () => {
    expect(assistsColor(10)).toBe(assistsColor(20))
    expect(assistsColor(3)).toBe(assistsColor(0))
    expect(assistsColor(4)).toBe(assistsColor(9))
  })

  it('groupRate: >=45 good / <=15 bad', () => {
    expect(groupRateColor(45)).toBe(groupRateColor(60))
    expect(groupRateColor(15)).toBe(groupRateColor(0))
    expect(groupRateColor(16)).toBe(groupRateColor(44))
  })

  it('healColorAndTaken: >=25 good else neutral (no bad tier)', () => {
    expect(healColorAndTaken(25)).toBe(healColorAndTaken(100))
    expect(healColorAndTaken(24.9)).toBe(healColorAndTaken(0))
  })

  it('other: >=25 good / <=15 bad', () => {
    expect(otherColor(25)).toBe(otherColor(50))
    expect(otherColor(15)).toBe(otherColor(1))
    expect(otherColor(16)).toBe(otherColor(24))
  })

  it('winRate: >=57 good / <=49 bad', () => {
    expect(winRateColor(57)).toBe(winRateColor(80))
    expect(winRateColor(49)).toBe(winRateColor(30))
    expect(winRateColor(50)).toBe(winRateColor(56))
  })
})
