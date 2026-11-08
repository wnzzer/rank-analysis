/**
 * 死亡归责：六类判定的优先级、责任系数与后果。
 * 名册见 timeline/__tests__/helpers：1-5 蓝方上野中下辅，6-10 红方同序。
 */
import { describe, it, expect } from 'vitest'
import { frame, input, pf } from '../../timeline/__tests__/helpers'
import type { SlimEvent } from '../../timeline/types'
import { attributeDeaths } from '../deathAttribution'

const MIN = 60000

function kill(
  timestamp: number,
  victimId: number,
  killerId: number,
  assisting: number[],
  x: number,
  y: number,
  shutdownBounty = 0
): SlimEvent {
  return {
    type: 'CHAMPION_KILL',
    timestamp,
    killerId,
    victimId,
    assisting,
    x,
    y,
    bounty: 300,
    shutdownBounty,
    damageReceived: []
  }
}

describe('attributeDeaths', () => {
  it('对位无助攻击杀 → 单杀，全责，无后果时 consequence = 1', () => {
    const out = attributeDeaths(input({ events: [kill(5 * MIN, 1, 6, [], 1000, 10000)] }))
    expect(out).toEqual([
      { victimId: 1, timestamp: 5 * MIN, kind: 'solo', responsibility: 1, consequence: 1 }
    ])
  })

  it('后果 = 1 + 60 秒内己方丢失资源/建筑数 + 终结赏金/300', () => {
    const out = attributeDeaths(
      input({
        events: [
          kill(5 * MIN, 1, 6, [], 1000, 10000, 450),
          {
            type: 'ELITE_MONSTER_KILL',
            timestamp: 5 * MIN + 20000,
            killerId: 7,
            killerTeamId: 200,
            monsterType: 'DRAGON',
            monsterSubType: '',
            x: 9866,
            y: 4414
          },
          {
            type: 'BUILDING_KILL',
            timestamp: 5 * MIN + 40000,
            killerId: 6,
            teamId: 100,
            buildingType: 'TOWER_BUILDING',
            towerType: 'OUTER_TURRET',
            laneType: 'TOP_LANE'
          }
        ]
      })
    )
    expect(out[0].consequence).toBeCloseTo(4.5)
  })

  it('最近队友 > 2000 码 → 孤立阵亡，全责', () => {
    const out = attributeDeaths(
      input({
        frames: [frame(19 * MIN), frame(21 * MIN)],
        events: [kill(20 * MIN, 3, 7, [8], 7000, 7000)]
      })
    )
    expect(out[0].kind).toBe('isolated')
    expect(out[0].responsibility).toBe(1)
  })

  it('对线期在本路被对面打野参与击杀 → 被抓，责任 0.5', () => {
    const out = attributeDeaths(
      input({
        frames: [frame(6 * MIN, [pf(2, { x: 1500, y: 10000 })])],
        events: [kill(6 * MIN, 1, 7, [6], 1000, 10000)]
      })
    )
    expect(out[0].kind).toBe('ganked')
    expect(out[0].responsibility).toBe(0.5)
  })

  it('同样阵容但死在中路（不在本人分路区域）→ 其他，0.8', () => {
    const out = attributeDeaths(
      input({
        frames: [frame(6 * MIN, [pf(2, { x: 7500, y: 7000 })])],
        events: [kill(6 * MIN, 1, 7, [6], 7000, 7000)]
      })
    )
    expect(out[0].kind).toBe('other')
    expect(out[0].responsibility).toBe(0.8)
  })

  it('下路 2v2 被对面 ADC+辅助击杀不算被抓', () => {
    const out = attributeDeaths(
      input({
        frames: [frame(6 * MIN, [pf(5, { x: 12500, y: 2000 })])],
        events: [kill(6 * MIN, 4, 9, [10], 12000, 2000)]
      })
    )
    expect(out[0].kind).toBe('other')
  })

  it('团战内阵亡 → 团战 0.6；30 秒内已有 ≥2 名队友先倒 → 队友先崩 0.3', () => {
    const near = [1, 2, 3, 4, 5].map(id => pf(id, { x: 7000, y: 7000 }))
    const out = attributeDeaths(
      input({
        frames: [frame(20 * MIN, near), frame(21 * MIN, near)],
        events: [
          kill(20 * MIN, 1, 8, [], 7000, 7000),
          kill(20 * MIN + 5000, 2, 6, [], 7000, 7000),
          kill(20 * MIN + 10000, 3, 7, [], 7000, 7000)
        ]
      })
    )
    expect(out.map(d => d.kind)).toEqual(['fight', 'fight', 'collapse'])
    expect(out.map(d => d.responsibility)).toEqual([0.6, 0.6, 0.3])
  })

  it('无分路模式：对面一人击杀也不判单杀/被抓', () => {
    const out = attributeDeaths(
      input(
        {
          frames: [frame(6 * MIN, [pf(2, { x: 1500, y: 10000 })])],
          events: [kill(6 * MIN, 1, 6, [], 1000, 10000)]
        },
        { hasLanes: false }
      )
    )
    expect(out[0].kind).toBe('other')
  })

  it('孤立的上单在本路被对面打野+上单击杀 → 被抓（0.5），优先于孤立', () => {
    const out = attributeDeaths(
      input({
        frames: [frame(6 * MIN)],
        events: [kill(6 * MIN, 1, 7, [6], 1000, 10000)]
      })
    )
    expect(out[0].kind).toBe('ganked')
    expect(out[0].responsibility).toBe(0.5)
  })

  it('孤立的上单被对位一人无助攻击杀 → 仍是单杀', () => {
    const out = attributeDeaths(
      input({
        frames: [frame(6 * MIN)],
        events: [kill(6 * MIN, 1, 6, [], 1000, 10000)]
      })
    )
    expect(out[0].kind).toBe('solo')
  })

  it('孤立的中单被对面上单（非抓人位置）击杀 → 孤立阵亡', () => {
    const out = attributeDeaths(
      input({
        frames: [frame(6 * MIN)],
        events: [kill(6 * MIN, 3, 6, [], 7000, 7000)]
      })
    )
    expect(out[0].kind).toBe('isolated')
  })

  describe('队友先崩要求队友死在附近', () => {
    const near = [1, 2, 3, 4, 5].map(id => pf(id, { x: 7000, y: 7000 }))
    const frames = [frame(19 * MIN, near), frame(20 * MIN, near), frame(21 * MIN, near)]
    const lastKind = (x: number, y: number) =>
      attributeDeaths(
        input({
          frames,
          events: [
            kill(20 * MIN - 25000, 1, 8, [], x, y),
            kill(20 * MIN - 25000, 2, 8, [], x, y),
            kill(20 * MIN, 3, 7, [], 7000, 7000)
          ]
        })
      )[2].kind

    it('两名队友 25 秒前死在 6000 码外 → 不算队友先崩', () => {
      expect(lastKind(1000, 10000)).not.toBe('collapse')
    })

    it('两名队友 25 秒前死在 2500 码内 → 队友先崩', () => {
      expect(lastKind(8500, 8500)).toBe('collapse')
    })
  })

  it('死者不在名册（victimId 0）不产出', () => {
    expect(attributeDeaths(input({ events: [kill(5 * MIN, 0, 6, [], 0, 0)] }))).toEqual([])
  })
})
