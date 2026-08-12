/**
 * 时间线纯函数单测（E-测试卡：时间线数据）。
 * 覆盖：指标取值、分钟轴、空数据容错、缺帧填充。
 */
import { describe, expect, it } from 'vitest'
import { TIMELINE_METRICS, buildTimelineSeries, fillSeries } from './timelineData'
import type { SgpGameDetail } from '@renderer/services/sgp'

function makeDetail(frames: Record<string, unknown>[]): SgpGameDetail {
  return {
    frames: frames as unknown as SgpGameDetail['frames'],
    participants: []
  }
}

describe('TIMELINE_METRICS', () => {
  it('三种指标：金币/补刀/经验', () => {
    expect(TIMELINE_METRICS.map(m => m.kind)).toEqual(['gold', 'cs', 'xp'])
  })

  it('金币取 currentGold，补刀 = minions + jungle，经验取 xp', () => {
    const frame = { currentGold: 1200, minionsKilled: 30, jungleMinionsKilled: 5, xp: 4200 }
    expect(TIMELINE_METRICS[0].value(frame as never)).toBe(1200)
    expect(TIMELINE_METRICS[1].value(frame as never)).toBe(35)
    expect(TIMELINE_METRICS[2].value(frame as never)).toBe(4200)
  })

  it('字段缺失/undefined 帧返回 0 不抛错', () => {
    expect(TIMELINE_METRICS[0].value(undefined)).toBe(0)
    expect(TIMELINE_METRICS[1].value(undefined)).toBe(0)
    expect(TIMELINE_METRICS[2].value({} as never)).toBe(0)
  })
})

describe('buildTimelineSeries', () => {
  it('null / 无帧返回空结构', () => {
    const empty = buildTimelineSeries(null, 'gold')
    expect(empty.byParticipant).toEqual({})
    expect(empty.minutes).toEqual([])
    expect(empty.frameCount).toBe(0)
    expect(buildTimelineSeries(makeDetail([]), 'gold').frameCount).toBe(0)
  })

  it('按分钟轴铺开并按指标取值', () => {
    const detail = makeDetail([
      {
        timestamp: 0,
        participantFrames: {
          1: { currentGold: 500, minionsKilled: 10, xp: 1000 },
          2: { currentGold: 600, minionsKilled: 8, xp: 900 }
        }
      },
      {
        timestamp: 60_000,
        participantFrames: {
          1: { currentGold: 800, minionsKilled: 20, xp: 2000 },
          2: { currentGold: 750, minionsKilled: 16, xp: 1900 }
        }
      }
    ])
    const gold = buildTimelineSeries(detail, 'gold')
    expect(gold.minutes).toEqual([0, 1])
    expect(gold.frameCount).toBe(2)
    expect(gold.byParticipant[1]).toEqual([
      { minute: 0, value: 500 },
      { minute: 1, value: 800 }
    ])
    const cs = buildTimelineSeries(detail, 'cs')
    expect(cs.byParticipant[2]).toEqual([
      { minute: 0, value: 8 },
      { minute: 1, value: 16 }
    ])
  })

  it('timestamp 缺省按 0 处理；分钟轴封顶 max', () => {
    const detail = makeDetail([
      { timestamp: undefined, participantFrames: { 1: { currentGold: 100 } } },
      { timestamp: 180_000, participantFrames: { 1: { currentGold: 300 } } }
    ])
    const gold = buildTimelineSeries(detail, 'gold')
    expect(gold.minutes).toEqual([0, 1, 2, 3])
    expect(gold.byParticipant[1].length).toBe(2)
  })
})

describe('fillSeries', () => {
  it('缺失分钟沿用前值补齐全轴', () => {
    const series = {
      1: [
        { minute: 0, value: 10 },
        { minute: 2, value: 30 }
      ]
    }
    const filled = fillSeries(series, [0, 1, 2, 3])
    expect(filled[1]).toEqual([
      { minute: 0, value: 10 },
      { minute: 1, value: 10 },
      { minute: 2, value: 30 },
      { minute: 3, value: 30 }
    ])
  })

  it('无数据玩家返回空（不产键）', () => {
    expect(fillSeries({}, [0, 1, 2])).toEqual({})
  })
})
