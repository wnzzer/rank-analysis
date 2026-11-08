import { describe, it, expect } from 'vitest'
import { fmtTime, positionAt, frameAtMinute, dist } from '../geometry'
import { zoneOf, buildingLabel, monsterLabel, slotLabel, sideLabel } from '../labels'
import { frame, pf, input } from './helpers'

describe('geometry', () => {
  it('should format mm:ss', () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(90500)).toBe('1:30')
    expect(fmtTime(872000)).toBe('14:32')
  })

  it('should interpolate positions between frames and clamp at ends', () => {
    const { tl } = input({
      frames: [frame(0, [pf(1, { x: 0, y: 0 })]), frame(60000, [pf(1, { x: 600, y: 1200 })])]
    })
    expect(positionAt(tl, 1, 30000)).toEqual({ x: 300, y: 600 })
    expect(positionAt(tl, 1, 999999)).toEqual({ x: 600, y: 1200 })
    expect(positionAt(tl, 99, 30000)).toBeNull()
  })

  it('should pick frame near minute within 30s', () => {
    const { tl } = input({ frames: [frame(0), frame(60010), frame(120020)] })
    expect(frameAtMinute(tl, 1)?.timestamp).toBe(60010)
    expect(frameAtMinute(tl, 5)).toBeUndefined()
  })

  it('should compute distance', () => {
    expect(dist(0, 0, 3, 4)).toBe(5)
  })
})

describe('labels', () => {
  it('should classify summoners rift zones', () => {
    expect(zoneOf(9866, 4414, 11)).toBe('小龙坑')
    expect(zoneOf(5007, 10471, 11)).toBe('大龙坑')
    expect(zoneOf(500, 500, 11)).toBe('蓝方基地')
    expect(zoneOf(14000, 14000, 11)).toBe('红方基地')
    expect(zoneOf(1000, 8000, 11)).toBe('上路（蓝方半场）')
    expect(zoneOf(6000, 6000, 11)).toBe('中路（蓝方半场）')
    expect(zoneOf(13500, 9000, 11)).toBe('下路（红方半场）')
    expect(zoneOf(4000, 10000, 11)).toBe('上半河道')
    expect(zoneOf(3500, 7000, 11)).toBe('蓝方上半野区')
    expect(zoneOf(10000, 7000, 11)).toBe('红方下半野区')
  })

  it('should classify howling abyss segments', () => {
    expect(zoneOf(500, 500, 12)).toBe('蓝方基地')
    expect(zoneOf(3000, 3000, 12)).toBe('蓝方塔区')
    expect(zoneOf(5000, 5000, 12)).toBe('蓝方半桥')
    expect(zoneOf(7500, 7500, 12)).toBe('红方半桥')
    expect(zoneOf(12500, 12500, 12)).toBe('红方基地')
  })

  it('should label buildings monsters slots sides', () => {
    expect(
      buildingLabel({
        buildingType: 'TOWER_BUILDING',
        towerType: 'OUTER_TURRET',
        laneType: 'BOT_LANE'
      })
    ).toBe('下路一塔')
    expect(
      buildingLabel({ buildingType: 'INHIBITOR_BUILDING', towerType: '', laneType: 'MID_LANE' })
    ).toBe('中路水晶')
    expect(monsterLabel('BARON_NASHOR')).toBe('大龙')
    expect(monsterLabel('HORDE')).toBe('虚空巢虫')
    expect(slotLabel(3)).toBe('R')
    expect(slotLabel(64)).toBe('普攻')
    expect(sideLabel(200)).toBe('红方')
  })
})
