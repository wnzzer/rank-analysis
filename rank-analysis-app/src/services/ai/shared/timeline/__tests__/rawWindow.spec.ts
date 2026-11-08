/**
 * renderRawEventWindow 单测：A/B 评测 V2 组原始事件窗口。
 */
import { describe, it, expect } from 'vitest'
import { renderRawEventWindow } from '../rawWindow'
import { input } from './helpers'

describe('renderRawEventWindow', () => {
  it('should list events within ±30s of kills involving the player', () => {
    const out = renderRawEventWindow(
      input({
        items: { '3031': { name: '无尽之刃', priceTotal: 3450, kind: 'legendary' } },
        events: [
          { type: 'ITEM_PURCHASED', timestamp: 100000, participantId: 4, itemId: 3031 },
          { type: 'WARD_PLACED', timestamp: 110000, creatorId: 4, wardType: 'YELLOW_TRINKET' },
          {
            type: 'CHAMPION_KILL',
            timestamp: 120000,
            killerId: 7,
            victimId: 4,
            assisting: [8],
            x: 9866,
            y: 4414,
            bounty: 300,
            shutdownBounty: 0,
            damageReceived: []
          },
          {
            type: 'ELITE_MONSTER_KILL',
            timestamp: 140000,
            killerId: 7,
            killerTeamId: 200,
            monsterType: 'DRAGON',
            monsterSubType: '',
            x: 0,
            y: 0
          },
          { type: 'ITEM_PURCHASED', timestamp: 400000, participantId: 4, itemId: 3031 }
        ]
      }),
      4
    )
    expect(out).toBe(
      [
        '1:40 卡莎 购买 无尽之刃',
        '1:50 卡莎 插眼(YELLOW_TRINKET)',
        '2:00 击杀 皇子→卡莎 助攻:妖姬 @小龙坑',
        '2:20 红方拿下小龙'
      ].join('\n')
    )
  })
})
