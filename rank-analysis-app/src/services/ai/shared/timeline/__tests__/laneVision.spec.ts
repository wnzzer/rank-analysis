/**
 * 对线卡与视野卡提取器单测：对位经济/经验/补刀差、镀层/单杀/首次死亡，插眼/排眼/真眼分桶。
 */
import { describe, it, expect } from 'vitest'
import { buildLaneCards } from '../cards/lane'
import { buildVisionCards } from '../cards/vision'
import { frame, pf, input } from './helpers'

const laneFrames = [
  frame(300000, [
    pf(4, { totalGold: 1600, xp: 1500, cs: 40 }),
    pf(9, { totalGold: 1500, xp: 1400, cs: 35 })
  ]),
  frame(600000, [
    pf(4, { totalGold: 3500, xp: 4000, cs: 80 }),
    pf(9, { totalGold: 3600, xp: 4100, cs: 85 })
  ]),
  frame(840000, [
    pf(4, { totalGold: 5200, xp: 6000, cs: 120 }),
    pf(9, { totalGold: 5000, xp: 5800, cs: 110 })
  ])
]

describe('buildLaneCards', () => {
  it('should compare against lane opponent at 5/10/14 with plates, solo kills, first death', () => {
    const cards = buildLaneCards(
      input({
        frames: laneFrames,
        events: [
          {
            type: 'TURRET_PLATE_DESTROYED',
            timestamp: 280000,
            killerId: 4,
            teamId: 200,
            laneType: 'BOT_LANE'
          },
          {
            type: 'TURRET_PLATE_DESTROYED',
            timestamp: 290000,
            killerId: 4,
            teamId: 200,
            laneType: 'BOT_LANE'
          },
          {
            type: 'CHAMPION_KILL',
            timestamp: 400000,
            killerId: 4,
            victimId: 9,
            assisting: [],
            x: 0,
            y: 0,
            bounty: 300,
            shutdownBounty: 0,
            damageReceived: []
          },
          {
            type: 'CHAMPION_KILL',
            timestamp: 700000,
            killerId: 9,
            victimId: 4,
            assisting: [10],
            x: 0,
            y: 0,
            bounty: 300,
            shutdownBounty: 0,
            damageReceived: []
          }
        ]
      })
    )
    const kaisa = cards.find(c => c.subjects[0] === 4)
    expect(kaisa).toMatchObject({ kind: 'lane', subjects: [4, 9] })
    expect(kaisa?.text).toBe(
      '卡莎 对线（对位 EZ）｜对位差值（正=领先）：5分钟 经济+100 经验+100 补刀+5｜10分钟 经济-100 经验-100 补刀-5｜14分钟 经济+200 经验+200 补刀+10｜镀层 2｜单杀 1 次｜首次死亡 11:40'
    )
    const ez = cards.find(c => c.subjects[0] === 9)
    expect(ez?.text).toContain('首次死亡 6:40')
  })

  it('should produce nothing without lanes', () => {
    expect(buildLaneCards(input({ frames: laneFrames }, { hasLanes: false }))).toEqual([])
  })
})

describe('buildVisionCards', () => {
  it('should bucket wards per 10 minutes', () => {
    const cards = buildVisionCards(
      input({
        frames: [frame(0), frame(1200000)],
        events: [
          { type: 'WARD_PLACED', timestamp: 100000, creatorId: 5, wardType: 'YELLOW_TRINKET' },
          { type: 'WARD_PLACED', timestamp: 200000, creatorId: 5, wardType: 'CONTROL_WARD' },
          { type: 'WARD_KILL', timestamp: 300000, killerId: 5, wardType: 'YELLOW_TRINKET' },
          { type: 'WARD_PLACED', timestamp: 700000, creatorId: 5, wardType: 'SIGHT_WARD' },
          { type: 'WARD_PLACED', timestamp: 710000, creatorId: 5, wardType: 'UNDEFINED' }
        ]
      })
    )
    const thresh = cards.find(c => c.subjects[0] === 5)
    expect(thresh?.text).toBe('锤石 视野｜0-10分钟 插眼2 排眼1｜10-20分钟 插眼1 排眼0｜真眼 1')
    expect(cards.find(c => c.subjects[0] === 1)?.text).toBe(
      '剑魔 视野｜0-10分钟 插眼0 排眼0｜10-20分钟 插眼0 排眼0｜真眼 0'
    )
  })
})
