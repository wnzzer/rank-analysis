import { describe, it, expect } from 'vitest'
import type { ParticipantStats } from '@renderer/types/domain/match'
import type { ItemStat } from '@renderer/services/builds'
import {
  STAT_ROWS,
  STAT_GROUPS,
  buildStatsTable,
  filterStatsRows,
  diffBuild,
  buildCompareRow,
  type StatsTablePlayer
} from './detailsTable'

function makeStats(partial: Partial<ParticipantStats>): ParticipantStats {
  return {
    win: true,
    item0: 0,
    item1: 0,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 0,
    perk0: 0,
    perkPrimaryStyle: 0,
    perkSubStyle: 0,
    playerAugment1: 0,
    playerAugment2: 0,
    playerAugment3: 0,
    playerAugment4: 0,
    playerAugment5: 0,
    playerAugment6: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    goldEarned: 0,
    goldSpent: 0,
    totalDamageDealtToChampions: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    totalHeal: 0,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    damageDealtToTurrets: 0,
    groupRate: 0,
    goldEarnedRate: 0,
    damageDealtToChampionsRate: 0,
    damageTakenRate: 0,
    healRate: 0,
    playerSubteamId: 0,
    subteamPlacement: 0,
    ...partial
  }
}

function makePlayer(
  index: number,
  teamId: number,
  stats: Partial<ParticipantStats>
): StatsTablePlayer {
  return {
    index,
    participantId: index + 1,
    teamId,
    displayName: `P${index + 1}`,
    championId: 1,
    win: teamId === 100,
    spell1Id: 4,
    spell2Id: 11,
    stats: makeStats(stats)
  }
}

describe('detailsTable', () => {
  describe('STAT_ROWS', () => {
    it('包含 6 个分组且组序固定（基础/击杀/伤害/经济/参团/其他）', () => {
      expect(STAT_GROUPS).toEqual(['基础', '击杀', '伤害', '经济', '参团', '其他'])
    })

    it('每行 key 唯一', () => {
      const keys = STAT_ROWS.map(r => r.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('同组行在数组中连续排列', () => {
      const positions = new Map<string, number[]>()
      STAT_ROWS.forEach((r, i) => {
        positions.set(r.group, [...(positions.get(r.group) ?? []), i])
      })
      for (const [, pos] of positions) {
        for (let i = 1; i < pos.length; i++) {
          expect(pos[i]).toBe(pos[i - 1] + 1)
        }
      }
    })
  })

  describe('buildStatsTable', () => {
    it('行数 = 行定义数，且按组连续排列', () => {
      const players = [makePlayer(0, 100, { kills: 10 }), makePlayer(1, 200, { kills: 5 })]
      const table = buildStatsTable(players)
      expect(table).toHaveLength(STAT_ROWS.length)
    })

    it('values 与玩家列一一对应（kills 行）', () => {
      const players = [makePlayer(0, 100, { kills: 10 }), makePlayer(1, 200, { kills: 5 })]
      const table = buildStatsTable(players)
      const killsRow = table.find(r => r.def.key === 'kills')!
      expect(killsRow.values).toEqual([10, 5])
      expect(killsRow.max).toBe(10)
    })

    it('多杀等可选字段缺失时该列为 NaN，max 忽略 NaN', () => {
      const players = [makePlayer(0, 100, { doubleKills: 2 }), makePlayer(1, 200, {})]
      const table = buildStatsTable(players)
      const row = table.find(r => r.def.key === 'doubleKills')!
      expect(Number.isNaN(row.values[0])).toBe(false)
      expect(row.values[0]).toBe(2)
      expect(Number.isNaN(row.values[1])).toBe(true)
      expect(row.max).toBe(2)
    })

    it('全缺失（视野得分）时 max 为 0', () => {
      const players = [makePlayer(0, 100, {}), makePlayer(1, 200, {})]
      const table = buildStatsTable(players)
      const row = table.find(r => r.def.key === 'visionScore')!
      expect(Number.isNaN(row.values[0])).toBe(true)
      expect(row.max).toBe(0)
    })

    it('自定义行定义可覆盖默认（SGP 增强追加行）', () => {
      const custom = [
        {
          key: 'x',
          label: '自定义',
          group: '其他' as const,
          value: (s: ParticipantStats) => s.kills,
          format: (v: number) => `${v}`
        }
      ]
      const players = [makePlayer(0, 100, { kills: 7 })]
      const table = buildStatsTable(players, custom)
      expect(table).toHaveLength(1)
      expect(table[0].def.key).toBe('x')
      expect(table[0].values).toEqual([7])
    })
  })

  describe('filterStatsRows', () => {
    const players = [makePlayer(0, 100, {}), makePlayer(1, 200, {})]
    const table = buildStatsTable(players)

    it('空关键词不过滤', () => {
      expect(filterStatsRows(table, '')).toHaveLength(table.length)
      expect(filterStatsRows(table, '   ')).toHaveLength(table.length)
    })

    it('按中文 label 匹配', () => {
      const result = filterStatsRows(table, '击杀')
      expect(result.map(r => r.def.key)).toEqual(['kills'])
    })

    it('按 key 匹配（忽略大小写）', () => {
      const result = filterStatsRows(table, 'GOLD')
      expect(result.map(r => r.def.key)).toEqual(['goldEarned', 'goldSpent', 'goldEarnedRate'])
    })

    it('无匹配返回空数组', () => {
      expect(filterStatsRows(table, '不存在的统计')).toEqual([])
    })
  })

  describe('diffBuild', () => {
    const rec = (ids: (number | null)[]): (ItemStat | null)[] =>
      ids.map(id => (id == null ? null : { itemId: id, count: 5, winCount: 3 }))

    // 推荐 7 槽（纯数字标识，与真实装备无关）：槽0~5 有推荐，槽6 无推荐
    const recommend = rec([101, 102, 103, 104, 105, 106, null])

    it('全部同槽位匹配 → overall match', () => {
      const d = diffBuild([101, 102, 103, 104, 105, 106, 0], recommend)
      expect(d.overall).toBe('match')
      expect(d.matched).toBe(6)
      expect(d.equipped).toBe(6)
      expect(d.slots).toEqual(['match', 'match', 'match', 'match', 'match', 'match', 'skip'])
    })

    it('空槽/饰品槽 → skip 且不参与统计', () => {
      // 槽0/6 为饰品(3340/3363)，槽1 为空 —— 均不计入 equipped
      const d = diffBuild([3340, 0, 103, 104, 105, 106, 3363], recommend)
      expect(d.equipped).toBe(4)
      expect(d.matched).toBe(4)
      expect(d.overall).toBe('match')
      expect(d.slots).toEqual(['skip', 'skip', 'match', 'match', 'match', 'match', 'skip'])
    })

    it('部分换装：30%~60% 匹配 → overall swap；不匹配槽标 swap', () => {
      // 6 件装备，3 件命中（103/104/105）→ 3/6 = 50%（≥30% 且 <60%）
      const d = diffBuild([201, 202, 203, 104, 105, 106, 0], recommend)
      expect(d.equipped).toBe(6)
      expect(d.matched).toBe(3)
      expect(d.overall).toBe('swap')
      expect(d.slots[0]).toBe('swap')
      expect(d.slots[3]).toBe('match')
    })

    it('乱出：<30% 匹配 → overall odd；推荐空位出装备 → 该槽 odd', () => {
      // 仅槽5 命中（1/6 ≈ 17% < 30%），且槽6 出了推荐里没有的装备 → 槽6 为 odd
      const d = diffBuild([201, 202, 203, 204, 205, 106, 301], recommend)
      expect(d.overall).toBe('odd')
      expect(d.slots[5]).toBe('match')
      expect(d.slots[6]).toBe('odd')
    })

    it('无推荐（null/空数组）→ 全部 skip，overall none', () => {
      const d1 = diffBuild([101, 102, 103, 104, 105, 106, 301], null)
      expect(d1.overall).toBe('none')
      expect(d1.equipped).toBe(0)
      expect(d1.slots.every(s => s === 'skip')).toBe(true)
      const d2 = diffBuild([101, 102, 103, 104, 105, 106, 301], rec([null, null]))
      expect(d2.overall).toBe('none')
    })

    it('出装不完整（equipped < 4）→ overall none 不评判', () => {
      const d = diffBuild([101, 102, 0, 0, 0, 0, 0], recommend)
      expect(d.equipped).toBe(2)
      expect(d.overall).toBe('none')
    })
  })

  describe('buildCompareRow', () => {
    const itemIdsOf = (s: ParticipantStats) => [
      s.item0,
      s.item1,
      s.item2,
      s.item3,
      s.item4,
      s.item5,
      s.item6
    ]
    const fullRec = [101, 102, 103, 104, 105, 106, null].map(id =>
      id == null ? null : ({ itemId: id, count: 5, winCount: 3 } as ItemStat)
    )

    it('按玩家英雄取推荐；英雄不同、列序对应', () => {
      const players = [
        makePlayer(0, 100, {
          item0: 101,
          item1: 102,
          item2: 103,
          item3: 104,
          item4: 105,
          item5: 106
        }),
        makePlayer(1, 200, {
          item0: 201,
          item1: 202,
          item2: 203,
          item3: 104,
          item4: 105,
          item5: 106
        })
      ]
      const cells = buildCompareRow(players, itemIdsOf, new Map([[1, fullRec]]))
      expect(cells).toHaveLength(2)
      // 两玩家英雄 id 都是 1 → 都有推荐
      expect(cells[0].recommend).not.toBeNull()
      expect(cells[0].diff.overall).toBe('match')
      expect(cells[1].recommend).not.toBeNull()
      expect(cells[1].diff.overall).toBe('swap') // 3/6 命中（<60% ≥30%）
    })

    it('无该英雄推荐（Map 无此 championId）→ recommend null + overall none', () => {
      const players = [makePlayer(0, 100, { item0: 101 })]
      const cells = buildCompareRow(players, itemIdsOf, new Map([[999, fullRec]]))
      expect(cells[0].recommend).toBeNull()
      expect(cells[0].diff.overall).toBe('none')
    })
  })
})
