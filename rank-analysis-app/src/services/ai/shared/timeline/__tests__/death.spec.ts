/**
 * 死亡卡提取器单测：击杀者/伤害来源/最近队友/后果丢失/终结赏金。
 */
import { describe, it, expect } from 'vitest'
import { buildDeathCards } from '../cards/death'
import { frame, pf, input } from './helpers'

const frames = [0, 60000].map(t =>
  frame(t, [
    pf(4, { x: 9000, y: 4000 }),
    pf(5, { x: 9000, y: 5000 }),
    pf(1, { x: 1000, y: 12000 }),
    pf(2, { x: 3000, y: 3000 }),
    pf(3, { x: 6000, y: 6000 })
  ])
)

describe('buildDeathCards', () => {
  it('should describe death with killers, damage sources, nearest ally and losses', () => {
    const cards = buildDeathCards(
      input({
        frames,
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 30000,
            killerId: 7,
            victimId: 4,
            assisting: [8],
            x: 9866,
            y: 4414,
            bounty: 300,
            shutdownBounty: 0,
            damageReceived: [
              { participantId: 7, total: 600, topSlot: 3 },
              { participantId: 8, total: 400, topSlot: 0 }
            ]
          },
          {
            type: 'ELITE_MONSTER_KILL',
            timestamp: 50000,
            killerId: 7,
            killerTeamId: 200,
            monsterType: 'DRAGON',
            monsterSubType: 'FIRE_DRAGON',
            x: 9866,
            y: 4414
          }
        ]
      })
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ kind: 'death', subjects: [4, 7, 8], weight: 3 })
    expect(cards[0].text).toBe(
      '0:30 卡莎(玩家4) 死于小龙坑｜击杀：皇子（助攻：妖姬）｜伤害来源：皇子60%（R为主）、妖姬40%（Q为主）｜最近队友约 1000 码｜之后 60 秒内己方丢失：小龙'
    )
  })

  it('should note shutdown and tower kill without champion killer', () => {
    const cards = buildDeathCards(
      input({
        frames,
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 30000,
            killerId: 0,
            victimId: 4,
            assisting: [],
            x: 9000,
            y: 4000,
            bounty: 0,
            shutdownBounty: 450,
            damageReceived: []
          },
          {
            type: 'BUILDING_KILL',
            timestamp: 70000,
            killerId: 9,
            teamId: 100,
            buildingType: 'TOWER_BUILDING',
            towerType: 'OUTER_TURRET',
            laneType: 'BOT_LANE'
          }
        ]
      })
    )
    expect(cards[0].text).toContain('击杀：防御塔/小兵')
    expect(cards[0].text).toContain('伤害来源：无明细')
    expect(cards[0].text).toContain('之后 60 秒内己方丢失：下路一塔')
    expect(cards[0].text).toContain('｜送出终结赏金 450')
    expect(cards[0].subjects).toEqual([4])
  })

  it('should omit the slot suffix when the top damage slot is unknown', () => {
    const cards = buildDeathCards(
      input({
        frames,
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 30000,
            killerId: 7,
            victimId: 4,
            assisting: [],
            x: 9000,
            y: 4000,
            bounty: 0,
            shutdownBounty: 0,
            damageReceived: [
              { participantId: 7, total: 800, topSlot: 99 },
              { participantId: 8, total: 200, topSlot: 0 }
            ]
          }
        ]
      })
    )
    expect(cards[0].text).toContain('伤害来源：皇子80%、妖姬20%（Q为主）')
  })

  it('should not present a tower/minion kill assister as the killer', () => {
    const cards = buildDeathCards(
      input({
        frames,
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 30000,
            killerId: 0,
            victimId: 4,
            assisting: [8],
            x: 9000,
            y: 4000,
            bounty: 0,
            shutdownBounty: 0,
            damageReceived: []
          }
        ]
      })
    )
    expect(cards[0].text).toContain('击杀：防御塔/小兵（助攻：妖姬）')
    expect(cards[0].subjects).toEqual([4, 8])
  })

  it('should report losses from an enemy-taken dragon within the window', () => {
    const cards = buildDeathCards(
      input({
        frames,
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 30000,
            killerId: 4,
            victimId: 9,
            assisting: [],
            x: 9000,
            y: 4000,
            bounty: 0,
            shutdownBounty: 0,
            damageReceived: []
          },
          {
            type: 'ELITE_MONSTER_KILL',
            timestamp: 50000,
            killerId: 4,
            killerTeamId: 100,
            monsterType: 'DRAGON',
            monsterSubType: 'FIRE_DRAGON',
            x: 9866,
            y: 4414
          }
        ]
      })
    )
    expect(cards[0].text.endsWith('之后 60 秒内己方丢失：小龙')).toBe(true)
  })

  it('should report no losses when the victim team takes the dragon', () => {
    const cards = buildDeathCards(
      input({
        frames,
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 30000,
            killerId: 4,
            victimId: 9,
            assisting: [],
            x: 9000,
            y: 4000,
            bounty: 0,
            shutdownBounty: 0,
            damageReceived: []
          },
          {
            type: 'ELITE_MONSTER_KILL',
            timestamp: 50000,
            killerId: 9,
            killerTeamId: 200,
            monsterType: 'DRAGON',
            monsterSubType: 'FIRE_DRAGON',
            x: 9866,
            y: 4414
          }
        ]
      })
    )
    expect(cards[0].text.endsWith('之后 60 秒内己方丢失：无')).toBe(true)
  })
})
