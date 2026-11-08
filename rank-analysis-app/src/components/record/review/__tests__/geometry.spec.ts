/**
 * 复盘图表几何换算：横纵百分比、折线 path、最近点、读数文案、小地图坐标。
 */
import { describe, it, expect } from 'vitest'
import {
  curvePath,
  leadText,
  mapPercent,
  nearestPoint,
  RIFT_SIZE,
  xPercent,
  yPercent
} from '../geometry'

describe('经济曲线几何', () => {
  it('xPercent：按对局时长线性换算并夹在 0~100', () => {
    expect(xPercent(10, 40)).toBe(25)
    expect(xPercent(50, 40)).toBe(100)
    expect(xPercent(-1, 40)).toBe(0)
    expect(xPercent(5, 0)).toBe(0)
  })

  it('yPercent：0 在中线，蓝方领先在上，最大值留 10% 边', () => {
    expect(yPercent(0, 4000)).toBe(50)
    expect(yPercent(4000, 4000)).toBeCloseTo(5)
    expect(yPercent(-4000, 4000)).toBeCloseTo(95)
    expect(yPercent(100, 0)).toBe(50)
  })

  it('curvePath：首点 M，其余 L', () => {
    const d = curvePath(
      [
        { minute: 0, diff: 0 },
        { minute: 20, diff: 2000 }
      ],
      40,
      2000
    )
    expect(d).toBe('M0.00 50.00 L50.00 5.00')
  })

  it('nearestPoint / leadText', () => {
    const pts = [
      { minute: 0, diff: 0 },
      { minute: 1, diff: -320 },
      { minute: 2, diff: 1234 }
    ]
    expect(nearestPoint(pts, 1.4)).toEqual(pts[1])
    expect(nearestPoint([], 3)).toBeNull()
    expect(leadText(pts[0])).toBe('0:00 经济持平')
    expect(leadText(pts[1])).toBe('1:00 红方领先 320')
    expect(leadText(pts[2])).toBe('2:00 蓝方领先 1234')
  })
})

describe('小地图坐标', () => {
  it('蓝方基地在左下、红方基地在右上，越界夹边', () => {
    expect(mapPercent(0, 0)).toEqual({ left: 0, top: 100 })
    expect(mapPercent(RIFT_SIZE, RIFT_SIZE)).toEqual({ left: 100, top: 0 })
    expect(mapPercent(RIFT_SIZE * 2, -5)).toEqual({ left: 100, top: 100 })
    const p = mapPercent(13773, 3917)
    expect(p.left).toBeCloseTo(92.62, 2)
    expect(p.top).toBeCloseTo(73.66, 2)
  })
})
