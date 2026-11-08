import { describe, it, expect } from 'vitest'
import { buildTurnCards } from '../cards/turn'
import { frame, pf, input } from './helpers'

const gold = [0, 0, 200, 2200, 2500, 2600, 2700]

describe('buildTurnCards', () => {
  it('should find the largest non-overlapping 2-minute gold swing and its events', () => {
    const cards = buildTurnCards(
      input({
        frames: gold.map((g, m) => frame(m * 60000, [pf(1, { totalGold: g })])),
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 150000,
            killerId: 1,
            victimId: 6,
            assisting: [],
            x: 0,
            y: 0,
            bounty: 300,
            shutdownBounty: 0,
            damageReceived: []
          },
          {
            type: 'BUILDING_KILL',
            timestamp: 200000,
            killerId: 1,
            teamId: 200,
            buildingType: 'TOWER_BUILDING',
            towerType: 'OUTER_TURRET',
            laneType: 'TOP_LANE'
          }
        ]
      })
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ kind: 'turn', subjects: [], weight: 3 })
    expect(cards[0].text).toBe(
      '2:00-4:00 经济转折：蓝方领先 200 → 蓝方领先 2500（蓝方 +2300）｜期间：击杀 蓝方1:0红方；蓝方推掉红方上路一塔'
    )
  })

  it('should skip swings under 1500', () => {
    const cards = buildTurnCards(
      input({ frames: [0, 100, 300].map((g, m) => frame(m * 60000, [pf(1, { totalGold: g })])) })
    )
    expect(cards).toEqual([])
  })
})
