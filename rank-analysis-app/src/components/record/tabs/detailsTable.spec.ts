import { describe, it, expect } from 'vitest'
import type { ParticipantStats } from '@renderer/types/domain/match'
import {
  STAT_ROWS,
  STAT_GROUPS,
  buildStatsTable,
  filterStatsRows,
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
})
