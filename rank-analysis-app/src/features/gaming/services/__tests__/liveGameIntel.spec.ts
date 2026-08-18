/**
 * liveGameIntel 确定性聚合单测：我方定位/经济差/出装匹配/团战聚类/死亡记录/文案。
 */

import { describe, expect, it } from 'vitest'
import type {
  LiveEvent,
  LiveGameSnapshot,
  LivePlayer
} from '@renderer/features/gaming/services/liveGame'
import {
  buildMatch,
  clusterLine,
  deathLine,
  formatGameClock,
  goldGap,
  liveIntelText,
  mainItems,
  myDeaths,
  myPlayer,
  playersOf,
  teamfightClusters,
  teamGold
} from '@renderer/features/gaming/services/liveGameIntel'
import type { ItemStat } from '@renderer/services/builds'

function player(name: string, over: Partial<LivePlayer> = {}): LivePlayer {
  return {
    championName: 'Ahri',
    position: 'MIDDLE',
    team: 'ORDER',
    isDead: false,
    summonerName: name,
    level: 13,
    items: [],
    scores: { assists: 4, creepScore: 178, deaths: 1, kills: 6, wardScore: 12 },
    gold: { total: 11050 },
    ...over
  }
}

function kill(time: number, killer: string, victim: string, assisters: string[] = []): LiveEvent {
  return {
    eventName: 'ChampionKill',
    eventTime: time,
    killerName: killer,
    victimName: victim,
    dragonType: null,
    towerName: null,
    assisters
  }
}

function snapshot(players: LivePlayer[], events: LiveEvent[] = []): LiveGameSnapshot {
  return {
    gameTime: 623.5,
    players,
    events,
    gameData: { gameMode: 'CLASSIC', gameTime: 623.5 }
  }
}

const ME = 'MidLaner'
const ME_LOWER = 'midlaner'

function itemStat(itemId: number, count = 10): ItemStat {
  return { itemId, count, winCount: 6 }
}

describe('liveGameIntel', () => {
  describe('myPlayer / playersOf / teamGold', () => {
    it('按召唤师名匹配我方（大小写不敏感）', () => {
      const s = snapshot([
        player(ME_LOWER),
        player('toplaner', { team: 'ORDER' }),
        player('enemy1', { team: 'CHAOS' })
      ])
      const me = myPlayer(s, 'MIDLANER')
      expect(me?.side).toBe('ORDER')
      expect(me?.player.summonerName).toBe(ME_LOWER)
      expect(playersOf(s, 'CHAOS')).toHaveLength(1)
      expect(teamGold(s, 'ORDER')).toBe(11050 * 2)
    })

    it('找不到我方召唤师时返回 null', () => {
      expect(myPlayer(snapshot([player('someone')]), 'nobody')).toBeNull()
    })
  })

  describe('goldGap', () => {
    it('计算我方相对敌方的经济差百分比（1 位小数）', () => {
      // ORDER 两人 11050+18950=30000；CHAOS 一人 28000
      const s = snapshot([
        player(ME, { gold: { total: 11050 } }),
        player('ally', { team: 'ORDER', gold: { total: 18950 } }),
        player('enemy1', { team: 'CHAOS', gold: { total: 28000 } })
      ])
      const gap = goldGap(s, ME)
      expect(gap?.myTeamGold).toBe(30000)
      expect(gap?.enemyTeamGold).toBe(28000)
      // (30000-28000)/28000 = 7.1428...% → 7.1
      expect(gap?.diffPct).toBe(7.1)
    })

    it('敌方 0 经济时 diffPct 为 null（不编数字）', () => {
      const s = snapshot([player(ME), player('enemy1', { team: 'CHAOS', gold: { total: 0 } })])
      expect(goldGap(s, ME)?.diffPct).toBeNull()
    })

    it('快照里没有我方时返回 null', () => {
      expect(goldGap(snapshot([player('other')]), ME)).toBeNull()
    })
  })

  describe('mainItems / buildMatch', () => {
    const ward = { itemID: 3340, itemCount: 1 }
    const mythic = { itemID: 3157, itemCount: 1 }
    const boots = { itemID: 3020, itemCount: 1 }

    it('剔除饰品后统计', () => {
      expect(mainItems(player(ME, { items: [mythic, ward, boots] }))).toHaveLength(2)
    })

    it('实际出装 vs 推荐：命中数/缺失数', () => {
      const rec: (ItemStat | null)[] = [
        itemStat(3157),
        itemStat(3020),
        itemStat(3158),
        itemStat(3135),
        itemStat(3165),
        itemStat(3190),
        itemStat(0)
      ]
      const actual = [mythic, boots, { itemID: 9999, itemCount: 1 }]
      const match = buildMatch(actual, rec)
      expect(match.matched).toBe(2)
      expect(match.total).toBe(3)
      // 只比前 3 个推荐槽：3158 是缺件
      expect(match.missing.map(m => m.itemId)).toEqual([3158])
    })

    it('没出装备时 matched/total 为 0 且无缺失', () => {
      expect(buildMatch([], [itemStat(3157)])).toEqual({ matched: 0, total: 0, missing: [] })
    })
  })

  describe('teamfightClusters', () => {
    it('窗口内多次击杀聚成一团，窗口外另起一团；低于阈值不输出', () => {
      const events = [
        kill(300, 'a', 'b'),
        kill(310, 'c', ME),
        kill(315, 'd', 'e'), // 300~345 窗口：3 死，其中我 1
        kill(400, 'f', 'g'),
        kill(401, 'h', 'i') // 400~445 窗口：2 死 < 3 → 不输出
      ]
      const clusters = teamfightClusters(events, ME)
      expect(clusters).toHaveLength(1)
      expect(clusters[0]).toEqual({ timeSecs: 300, deaths: 3, myDeaths: 1 })
    })

    it('事件乱序时先排序再聚类', () => {
      const events = [kill(315, 'd', 'e'), kill(300, 'c', ME), kill(310, 'a', 'b')]
      const clusters = teamfightClusters(events, ME)
      expect(clusters).toHaveLength(1)
      expect(clusters[0].timeSecs).toBe(300)
      expect(clusters[0].deaths).toBe(3)
    })

    it('自定义窗口与阈值', () => {
      const events = [kill(100, 'a', 'b'), kill(500, 'c', 'd')]
      expect(teamfightClusters(events, ME, { windowSecs: 500, minDeaths: 2 })).toHaveLength(1)
    })
  })

  describe('myDeaths', () => {
    it('只取 victim=我的击杀事件并按时间升序', () => {
      const events = [
        kill(400, 'enemy1', 'other'),
        kill(300, 'enemy1', ME),
        kill(310, 'enemy2', ME, ['enemy1'])
      ]
      const deaths = myDeaths(events, 'MIDLANER')
      expect(deaths).toHaveLength(2)
      expect(deaths[0]).toEqual({ timeSecs: 300, killer: 'enemy1', assisters: [] })
      expect(deaths[1].assisters).toEqual(['enemy1'])
    })
  })

  describe('文案', () => {
    it('formatGameClock 秒 → m:ss', () => {
      expect(formatGameClock(623)).toBe('10:23')
      expect(formatGameClock(60)).toBe('01:00')
      expect(formatGameClock(0)).toBe('00:00')
      expect(formatGameClock(-5)).toBe('00:00')
    })

    it('clusterLine / deathLine', () => {
      expect(clusterLine({ timeSecs: 492, deaths: 4, myDeaths: 1 })).toBe(
        '08:12 一波（双方共 4 死，我方 1）'
      )
      expect(clusterLine({ timeSecs: 492, deaths: 3, myDeaths: 0 })).toBe(
        '08:12 一波（双方共 3 死）'
      )
      expect(deathLine({ timeSecs: 273, killer: 'Zed', assisters: [] })).toBe('04:33 被 Zed 击杀')
      expect(deathLine({ timeSecs: 273, killer: 'Zed', assisters: ['a', 'b'] })).toBe(
        '04:33 被 Zed 击杀（+2 助攻）'
      )
    })

    it('liveIntelText：无我时不输出任何行', () => {
      expect(liveIntelText(snapshot([player('other')]), ME, null)).toBe('')
    })

    it('liveIntelText：经济 + 我的状态 + 团战 + 死亡全量块', () => {
      const s = snapshot(
        [
          player(ME, {
            items: [
              { itemID: 3157, itemCount: 1 },
              { itemID: 3340, itemCount: 1 }
            ]
          }),
          player('enemy1', { team: 'CHAOS', gold: { total: 9000 } })
        ],
        [kill(300, 'enemy1', ME)]
      )
      const text = liveIntelText(s, ME, [itemStat(3157), itemStat(3020)])
      expect(text).toContain('【对局实时数据（确定性计算，只可引用）】')
      expect(text).toContain('经济：我方（ORDER）11050 vs 敌方 9000（我方领先 22.8%）')
      expect(text).toContain('我：Ahri（MIDDLE）Lv13，6/1/4 KDA，补刀 178（存活）')
      expect(text).toContain('出装 1/1 件匹配推荐')
      expect(text).toContain('我的死亡：05:00 被 enemy1 击杀')
    })

    it('liveIntelText：无推荐时不写出装行', () => {
      const s = snapshot([player(ME)])
      const text = liveIntelText(s, ME, null)
      expect(text).not.toContain('匹配推荐')
    })
  })
})
