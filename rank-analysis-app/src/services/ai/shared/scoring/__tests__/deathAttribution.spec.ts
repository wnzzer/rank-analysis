/**
 * 死亡归责：六类判定的优先级、责任系数与后果。
 * 名册见 timeline/__tests__/helpers：1-5 蓝方上野中下辅，6-10 红方同序。
 */
import { describe, it, expect } from 'vitest'
import { frame, input, pf } from '../../timeline/__tests__/helpers'
import type { SlimEvent } from '../../timeline/types'
import { attributeDeaths, blameOf } from '../deathAttribution'

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
      {
        victimId: 1,
        timestamp: 5 * MIN,
        kind: 'solo',
        responsibility: 1,
        enemies: 1,
        allies: 1,
        consequence: 1
      }
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

  describe('以少打多：按人数差（敌方参与 − 我方在场）衰减本人责任', () => {
    it('对线期被 3 人包（被抓）→ 0.5 × 0.75，辅助在身边不追责', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 12300, y: 2200 })])],
          events: [kill(6 * MIN, 4, 9, [10, 7], 12000, 2000)]
        })
      )
      expect(out[0]).toMatchObject({ kind: 'ganked', enemies: 3, responsibility: 0.38 })
      expect(out[0].absentPartner).toBeUndefined()
    })

    it('后期边路被 4 包 1：仍是孤立，但不再吃满全责（1 × 0.6）', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(19 * MIN), frame(21 * MIN)],
          events: [kill(20 * MIN, 1, 6, [7, 8, 9], 1000, 10000)]
        })
      )
      expect(out[0]).toMatchObject({ kind: 'isolated', enemies: 4, responsibility: 0.6 })
    })

    it('被塔终结时塔不算人：只数助攻的敌方英雄', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(19 * MIN), frame(21 * MIN)],
          events: [kill(20 * MIN, 1, 0, [6, 7, 8], 1000, 10000)]
        })
      )
      expect(out[0].enemies).toBe(3)
    })

    it('人数相当的团战（4 打 3）不衰减', () => {
      const near = [1, 2, 3, 4, 5].map(id => pf(id, { x: 7000, y: 7000 }))
      const out = attributeDeaths(
        input({
          frames: [frame(20 * MIN, near), frame(21 * MIN, near)],
          events: [
            kill(20 * MIN, 1, 8, [6, 7, 9], 7000, 7000),
            kill(20 * MIN + 5000, 2, 6, [7], 7000, 7000),
            kill(20 * MIN + 10000, 3, 7, [], 7000, 7000)
          ]
        })
      )
      expect(out[0]).toMatchObject({ kind: 'fight', enemies: 4, allies: 3, responsibility: 0.6 })
    })

    describe('后期 4 包 2（AD + 辅助被抓）', () => {
      const pos = [pf(4, { x: 7000, y: 7000 }), pf(5, { x: 7200, y: 7000 })]
      const frames = [frame(19 * MIN, pos), frame(21 * MIN, pos)]
      const lost = [
        kill(20 * MIN, 4, 6, [7, 8, 9], 7000, 7000),
        kill(20 * MIN + 3000, 5, 7, [6, 8, 9], 7200, 7000)
      ]

      it('我方在场 2 人：按差 2 人衰减（×0.75），比 4 包 1 的 ×0.6 减得少', () => {
        const out = attributeDeaths(input({ frames, events: lost }))
        expect(out[0]).toMatchObject({ enemies: 4, allies: 2 })
        expect(out[0].responsibility).toBeCloseTo(0.8 * 0.75)
      })

      it('换掉对面一人凑成「团战」后，责任不再比没换到时更重', () => {
        const noTrade = attributeDeaths(input({ frames, events: lost }))
        const traded = attributeDeaths(
          input({ frames, events: [...lost, kill(20 * MIN + 1500, 9, 4, [5], 7100, 7000)] })
        )
        const adNo = noTrade.find(d => d.victimId === 4)!
        const adTraded = traded.find(d => d.victimId === 4)!
        expect(adTraded.kind).toBe('fight')
        expect(adTraded.allies).toBe(2)
        expect(adTraded.responsibility).toBeLessThanOrEqual(adNo.responsibility)
      })
    })
  })

  describe('搭档缺位：对线期辅助不在身边时 AD 阵亡', () => {
    it('AD 被对面下路 2v1、辅助在中路 → 辅助分担 0.3，AD 责任 × 0.7', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 7000, y: 7000 })])],
          events: [kill(6 * MIN, 4, 9, [10], 12000, 2000)]
        })
      )
      expect(out[0]).toMatchObject({
        kind: 'isolated',
        enemies: 2,
        responsibility: 0.7,
        absentPartner: { participantId: 5, share: 0.3 }
      })
    })

    it('同样 2v1 但辅助就在旁边 → 不追责', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 12500, y: 2000 })])],
          events: [kill(6 * MIN, 4, 9, [10], 12000, 2000)]
        })
      )
      expect(out[0].absentPartner).toBeUndefined()
    })

    it('辅助 30 秒内先倒下（一起打输）不算缺位', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 7000, y: 7000 })])],
          events: [
            kill(6 * MIN - 10000, 5, 10, [9], 12000, 2000),
            kill(6 * MIN, 4, 9, [10], 12000, 2000)
          ]
        })
      )
      expect(out[1].absentPartner).toBeUndefined()
    })

    it('辅助随后 30 秒内也倒下（2v3 一起打输）不算缺位', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 7000, y: 7000 })])],
          events: [
            kill(6 * MIN, 4, 9, [10], 12000, 2000),
            kill(6 * MIN + 5000, 5, 10, [9], 12000, 2000)
          ]
        })
      )
      expect(out[0].absentPartner).toBeUndefined()
    })

    it('责任守恒：AD 被打野 gank（池 0.5）时辅助只分走 AD 减掉的那份，不凭空多出', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 7000, y: 7000 })])],
          events: [kill(6 * MIN, 4, 7, [9], 12000, 2000)]
        })
      )
      expect(out[0]).toMatchObject({
        kind: 'ganked',
        responsibility: 0.35,
        absentPartner: { participantId: 5, share: 0.15 }
      })
      expect(blameOf(out[0], 4) + blameOf(out[0], 5)).toBeCloseTo(0.5)
    })

    it('被对位单杀不怪辅助（至少 2 名敌人才追责）', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 7000, y: 7000 })])],
          events: [kill(6 * MIN, 4, 9, [], 12000, 2000)]
        })
      )
      expect(out[0]).toMatchObject({ kind: 'solo', responsibility: 1 })
      expect(out[0].absentPartner).toBeUndefined()
    })

    it('过了对线期不追责：中后期辅助跟团是本职', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(19 * MIN, [pf(5, { x: 7000, y: 7000 })]), frame(21 * MIN)],
          events: [kill(20 * MIN, 4, 9, [10], 12000, 2000)]
        })
      )
      expect(out[0].absentPartner).toBeUndefined()
    })

    it('中单被抓时辅助不在不追责：职责表只有辅助 → AD', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 12500, y: 2000 })])],
          events: [kill(6 * MIN, 3, 8, [7], 7000, 7000)]
        })
      )
      expect(out[0].absentPartner).toBeUndefined()
    })

    it('blameOf：死者取本人责任，缺位搭档取分担，无关者为 0', () => {
      const [d] = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(5, { x: 7000, y: 7000 })])],
          events: [kill(6 * MIN, 4, 9, [10], 12000, 2000)]
        })
      )
      expect([blameOf(d, 4), blameOf(d, 5), blameOf(d, 3)]).toEqual([0.7, 0.3, 0])
    })
  })

  describe('辅助本人阵亡减责（× 0.8）', () => {
    it('辅助在下路被 2v1、AD 在身边 → 其他 0.8 × 0.8', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(4, { x: 12300, y: 2200 })])],
          events: [kill(6 * MIN, 5, 9, [10], 12000, 2000)]
        })
      )
      expect(out[0]).toMatchObject({ kind: 'other', responsibility: 0.64 })
    })

    it('辅助被对位单杀仍是全责', () => {
      const out = attributeDeaths(
        input({
          frames: [frame(6 * MIN, [pf(4, { x: 12300, y: 2200 })])],
          events: [kill(6 * MIN, 5, 10, [], 12000, 2000)]
        })
      )
      expect(out[0]).toMatchObject({ kind: 'solo', responsibility: 1 })
    })
  })

  it('死者不在名册（victimId 0）不产出', () => {
    expect(attributeDeaths(input({ events: [kill(5 * MIN, 0, 6, [], 0, 0)] }))).toEqual([])
  })
})

describe('牵制换资源（第 3 层）', () => {
  const T = 20 * MIN
  const baron: SlimEvent = {
    type: 'ELITE_MONSTER_KILL',
    timestamp: T + 30000,
    killerId: 2,
    killerTeamId: 100,
    monsterType: 'BARON_NASHOR',
    monsterSubType: '',
    x: 5007,
    y: 10471
  }
  const tower: SlimEvent = {
    type: 'BUILDING_KILL',
    timestamp: T + 40000,
    killerId: 6,
    teamId: 100,
    buildingType: 'TOWER_BUILDING',
    towerType: 'OUTER_TURRET',
    laneType: 'BOT_LANE'
  }

  it('被 3 人包抄、己方换到大龙：后果按净值（丢塔 − 大龙 = 0），标记 traded', () => {
    const [x] = attributeDeaths(
      input({ events: [kill(T, 4, 6, [7, 8], 13000, 2000), baron, tower] })
    )
    expect(x.enemies).toBe(3)
    expect(x.traded).toBe(true)
    expect(x.consequence).toBe(1)
  })

  it('换到的比丢的多：净值不低于 0', () => {
    const [x] = attributeDeaths(input({ events: [kill(T, 4, 6, [7, 8], 13000, 2000), baron] }))
    expect(x.consequence).toBe(1)
    expect(x.traded).toBe(true)
  })

  it('只有 2 人参与：不算牵制，后果照常累加', () => {
    const [x] = attributeDeaths(input({ events: [kill(T, 4, 6, [7], 13000, 2000), baron, tower] }))
    expect(x.traded).toBeUndefined()
    expect(x.consequence).toBe(2)
  })

  it('被包但己方什么都没换到：不标记，后果照常', () => {
    const [x] = attributeDeaths(input({ events: [kill(T, 4, 6, [7, 8], 13000, 2000), tower] }))
    expect(x.traded).toBeUndefined()
    expect(x.consequence).toBe(2)
  })
})
