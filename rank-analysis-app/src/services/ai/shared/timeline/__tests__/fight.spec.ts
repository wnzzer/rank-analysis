/**
 * 团战卡提取器单测：击杀聚类阈值（≥3 杀、20 秒链、2500 码）、参战/缺席名单、团后资源。
 */
import { describe, it, expect } from 'vitest'
import { buildFightCards } from '../cards/fight'
import { frame, pf, input } from './helpers'
import type { SlimEvent } from '../types'

const kill = (
  timestamp: number,
  killerId: number,
  victimId: number,
  assisting: number[] = []
): SlimEvent => ({
  type: 'CHAMPION_KILL',
  timestamp,
  killerId,
  victimId,
  assisting,
  x: 5007,
  y: 10471,
  bounty: 300,
  shutdownBounty: 0,
  damageReceived: []
})

const frames = [60000, 120000].map(t =>
  frame(t, [
    pf(2, { x: 5000, y: 9000 }),
    pf(6, { x: 14000, y: 14000 }),
    pf(10, { x: 14000, y: 14000 })
  ])
)

describe('buildFightCards', () => {
  it('should cluster 3+ kills into one fight with presence and aftermath', () => {
    const cards = buildFightCards(
      input({
        frames,
        events: [
          kill(100000, 7, 4),
          kill(105000, 1, 9),
          kill(110000, 8, 5, [7]),
          {
            type: 'ELITE_MONSTER_KILL',
            timestamp: 150000,
            killerId: 7,
            killerTeamId: 200,
            monsterType: 'BARON_NASHOR',
            monsterSubType: '',
            x: 5007,
            y: 10471
          }
        ]
      })
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ kind: 'fight', subjects: [1, 2, 4, 5, 7, 8, 9], weight: 5 })
    expect(cards[0].text).toBe(
      '1:40 大龙坑团战（10 秒）｜人头 蓝方1:2红方｜参战（约）：蓝方 剑魔、盲僧、卡莎、锤石 / 红方 皇子、妖姬、EZ｜缺席（约）：蓝方 发条 / 红方 诺手、璐璐｜团后 90 秒：红方拿下大龙'
    )
  })

  it('should ignore skirmishes under 3 kills and split far-apart kills', () => {
    const cards = buildFightCards(
      input({ frames, events: [kill(100000, 7, 4), kill(105000, 1, 9), kill(200000, 8, 5)] })
    )
    expect(cards).toEqual([])
  })
})
