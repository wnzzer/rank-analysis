import { describe, it, expect } from 'vitest'
import {
  aggregateChampionPool,
  championWinRate,
  filterChampionPoolByThresholds,
  type ChampionPoolEntry
} from './championPool'
import type { Game, Participant, ParticipantStats } from '@renderer/types/domain/match'

function makeGame(championId: number, win: boolean): Game {
  const stats: ParticipantStats = {
    win,
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
    subteamPlacement: 0
  }
  const participant: Participant = {
    win,
    participantId: 1,
    teamId: 0,
    championId,
    spell1Id: 0,
    spell2Id: 0,
    stats
  }
  return {
    mvp: '',
    gameDetail: { participants: [], participantIdentities: [], endOfGameResult: '' },
    gameId: Math.random(),
    gameCreationDate: new Date(Date.now() - 3_600_000).toISOString(),
    gameDuration: 1800,
    gameMode: '',
    gameType: '',
    mapId: 0,
    queueId: 420,
    queueName: '',
    platformId: '',
    participantIdentities: [],
    participants: [participant]
  }
}

describe('championPool', () => {
  it('空列表返回空聚合', () => {
    expect(aggregateChampionPool([])).toEqual([])
  })

  it('按英雄聚合场次与胜负', () => {
    const games = [
      makeGame(103, true),
      makeGame(103, true),
      makeGame(103, false),
      makeGame(157, false)
    ]
    const pool = aggregateChampionPool(games)
    expect(pool).toHaveLength(2)
    const ahri = pool.find(e => e.championId === 103)!
    expect(ahri.count).toBe(3)
    expect(ahri.wins).toBe(2)
    expect(ahri.losses).toBe(1)
    expect(ahri.games).toHaveLength(3)
  })

  it('出场次数降序排序（次数相同按胜场）', () => {
    const games = [makeGame(1, true), makeGame(2, true), makeGame(2, true), makeGame(3, false)]
    const pool = aggregateChampionPool(games)
    expect(pool.map(e => e.championId)).toEqual([2, 1, 3])
  })

  it('跳过 championId 缺失/非正的脏数据', () => {
    const bad = makeGame(0, true)
    const games = [bad, makeGame(5, true)]
    const pool = aggregateChampionPool(games)
    expect(pool).toHaveLength(1)
    expect(pool[0].championId).toBe(5)
  })

  it('championWinRate 四舍五入为整数百分比', () => {
    const entry: ChampionPoolEntry = {
      championId: 103,
      count: 3,
      wins: 2,
      losses: 1,
      winRate: 0,
      games: []
    }
    expect(championWinRate(entry)).toBe(67)
    expect(championWinRate({ ...entry, count: 0, wins: 0 })).toBe(0)
  })

  it('filterChampionPoolByThresholds 同时满足胜率与场次门槛', () => {
    const pool: ChampionPoolEntry[] = [
      { championId: 1, count: 10, wins: 7, losses: 3, winRate: 0, games: [] }, // 70% ✓
      { championId: 2, count: 6, wins: 3, losses: 3, winRate: 0, games: [] }, // 50% ✗ (<55)
      { championId: 3, count: 3, wins: 3, losses: 0, winRate: 0, games: [] }, // 100% 但场次 ✗ (<5)
      { championId: 4, count: 8, wins: 4, losses: 4, winRate: 0, games: [] }, // 50% ✗
      { championId: 5, count: 20, wins: 12, losses: 8, winRate: 0, games: [] } // 60% ✓
    ]
    const kept = filterChampionPoolByThresholds(pool, 55, 5)
    expect(kept.map(e => e.championId)).toEqual([1, 5])
  })

  it('filterChampionPoolByThresholds 门槛为零时不筛除任何条目', () => {
    const pool: ChampionPoolEntry[] = [
      { championId: 1, count: 2, wins: 1, losses: 1, winRate: 0, games: [] },
      { championId: 2, count: 0, wins: 0, losses: 0, winRate: 0, games: [] }
    ]
    expect(filterChampionPoolByThresholds(pool, 0, 0)).toHaveLength(2)
  })
})
