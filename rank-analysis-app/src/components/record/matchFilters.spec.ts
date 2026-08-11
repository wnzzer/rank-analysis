import { describe, it, expect } from 'vitest'
import {
  TIME_WINDOW_HOURS,
  TIME_WINDOW_OPTIONS,
  RESULT_OPTIONS,
  createDefaultFilter,
  hasActiveFilter,
  matchesFilter,
  filterMatches
} from './matchFilters'
import type { Game, Participant, ParticipantStats } from '@renderer/types/domain/match'

function makeGame(
  overrides: Partial<Game> & { stats?: Partial<ParticipantStats>; championId?: number } = {}
): Game {
  const stats: ParticipantStats = {
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
    ...overrides.stats
  }
  const participant: Participant = {
    win: stats.win,
    participantId: 1,
    teamId: 0,
    championId: overrides.championId ?? 1,
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
    participants: [participant],
    ...overrides
  }
}

describe('matchFilters', () => {
  describe('hasActiveFilter', () => {
    it('默认筛选不生效', () => {
      expect(hasActiveFilter(createDefaultFilter())).toBe(false)
    })

    it('任一条件生效即 true', () => {
      expect(hasActiveFilter({ ...createDefaultFilter(), queueId: 420 })).toBe(true)
      expect(hasActiveFilter({ ...createDefaultFilter(), championId: 3 })).toBe(true)
      expect(hasActiveFilter({ ...createDefaultFilter(), result: 'loss' })).toBe(true)
      expect(hasActiveFilter({ ...createDefaultFilter(), timeWindowHours: 24 })).toBe(true)
    })
  })

  describe('matchesFilter', () => {
    const winGame = makeGame({ queueId: 420, stats: { win: true } })
    const lossGame = makeGame({ queueId: 440, stats: { win: false } })

    it('默认筛选全部命中', () => {
      const f = createDefaultFilter()
      expect(matchesFilter(winGame, f)).toBe(true)
      expect(matchesFilter(lossGame, f)).toBe(true)
    })

    it('按模式过滤', () => {
      expect(matchesFilter(winGame, { ...createDefaultFilter(), queueId: 440 })).toBe(false)
      expect(matchesFilter(lossGame, { ...createDefaultFilter(), queueId: 440 })).toBe(true)
    })

    it('按英雄过滤', () => {
      const ahri = makeGame({ championId: 103 })
      expect(matchesFilter(ahri, { ...createDefaultFilter(), championId: 103 })).toBe(true)
      expect(matchesFilter(ahri, { ...createDefaultFilter(), championId: 104 })).toBe(false)
    })

    it('按胜负过滤', () => {
      expect(matchesFilter(winGame, { ...createDefaultFilter(), result: 'win' })).toBe(true)
      expect(matchesFilter(lossGame, { ...createDefaultFilter(), result: 'win' })).toBe(false)
      expect(matchesFilter(winGame, { ...createDefaultFilter(), result: 'loss' })).toBe(false)
      expect(matchesFilter(lossGame, { ...createDefaultFilter(), result: 'loss' })).toBe(true)
    })

    it('按时间窗口过滤（1 小时前的对局被近 3 小时命中，被近 24 分钟窗口排除）', () => {
      const oldGame = makeGame({
        gameCreationDate: new Date(Date.now() - 3_600_000).toISOString()
      })
      expect(matchesFilter(oldGame, { ...createDefaultFilter(), timeWindowHours: 3 })).toBe(true)
      expect(matchesFilter(oldGame, { ...createDefaultFilter(), timeWindowHours: 24 / 60 })).toBe(
        false
      )
    })

    it('异常时间戳按"超窗"处理（不因脏数据全放行）', () => {
      const badGame = makeGame({ gameCreationDate: 'not-a-date' })
      expect(matchesFilter(badGame, { ...createDefaultFilter(), timeWindowHours: 24 })).toBe(false)
      expect(matchesFilter(badGame, createDefaultFilter())).toBe(true)
    })
  })

  describe('filterMatches', () => {
    it('组合条件过滤并保持原顺序', () => {
      const games = [
        makeGame({ queueId: 420, stats: { win: true } }),
        makeGame({ queueId: 440, stats: { win: false } }),
        makeGame({ queueId: 420, stats: { win: false } })
      ]
      const out = filterMatches(games, { ...createDefaultFilter(), queueId: 420 })
      expect(out).toHaveLength(2)
      expect(out.map(g => g.participants[0].stats.win)).toEqual([true, false])
    })

    it('无命中返回空数组', () => {
      const games = [makeGame({ queueId: 420, stats: { win: true } })]
      expect(filterMatches(games, { ...createDefaultFilter(), queueId: 999 })).toEqual([])
    })
  })

  describe('选项常量', () => {
    it('时间窗口选项与常量一致', () => {
      expect(TIME_WINDOW_OPTIONS.map(o => o.value)).toEqual([...TIME_WINDOW_HOURS])
    })

    it('胜负选项含全部/胜/负', () => {
      expect(RESULT_OPTIONS.map(o => o.value)).toEqual(['all', 'win', 'loss'])
    })
  })
})
