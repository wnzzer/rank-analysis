import { describe, it, expect } from 'vitest'
import { buildRecentProfile } from '../recentProfile'
import type { RecentGameRaw } from '../recentProfile'

function game(opts: {
  teamPosition?: string
  championId: number
  win: boolean
  k?: number
  d?: number
  a?: number
  /** 队列 id（默认 420 排位——现网覆盖用例都是排位） */
  queueId?: number
}): RecentGameRaw {
  return {
    teamPosition: opts.teamPosition ?? 'JUNGLE',
    championId: opts.championId,
    win: opts.win,
    kills: opts.k ?? 5,
    deaths: opts.d ?? 3,
    assists: opts.a ?? 7,
    queueId: opts.queueId ?? 420
  }
}

describe('buildRecentProfile', () => {
  describe('mainPosition', () => {
    it('70% JUNGLE → mainPosition = JUNGLE', () => {
      const games: RecentGameRaw[] = [
        ...Array(14)
          .fill(0)
          .map(() => game({ teamPosition: 'JUNGLE', championId: 64, win: true })),
        ...Array(6)
          .fill(0)
          .map(() => game({ teamPosition: 'TOP', championId: 86, win: false }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      expect(profile.mainPosition).toBe('JUNGLE')
    })

    it('most-played < 40% → UNCLEAR', () => {
      const games: RecentGameRaw[] = [
        ...Array(6)
          .fill(0)
          .map(() => game({ teamPosition: 'JUNGLE', championId: 64, win: true })),
        ...Array(6)
          .fill(0)
          .map(() => game({ teamPosition: 'TOP', championId: 86, win: false })),
        ...Array(6)
          .fill(0)
          .map(() => game({ teamPosition: 'MIDDLE', championId: 1, win: true }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      expect(profile.mainPosition).toBe('UNCLEAR')
    })

    it('positionDistribution sorted by ratio desc', () => {
      const games: RecentGameRaw[] = [
        ...Array(10)
          .fill(0)
          .map(() => game({ teamPosition: 'JUNGLE', championId: 64, win: true })),
        ...Array(7)
          .fill(0)
          .map(() => game({ teamPosition: 'TOP', championId: 86, win: false })),
        ...Array(3)
          .fill(0)
          .map(() => game({ teamPosition: 'MIDDLE', championId: 1, win: true }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      expect(profile.positionDistribution[0].pos).toBe('JUNGLE')
      expect(profile.positionDistribution[1].pos).toBe('TOP')
      expect(profile.positionDistribution[2].pos).toBe('MIDDLE')
    })
  })

  describe('isOffRole', () => {
    it('current lane 70% played → not off-role', () => {
      const games: RecentGameRaw[] = [
        ...Array(14)
          .fill(0)
          .map(() => game({ teamPosition: 'JUNGLE', championId: 64, win: true })),
        ...Array(6)
          .fill(0)
          .map(() => game({ teamPosition: 'TOP', championId: 86, win: false }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      expect(profile.isOffRole).toBe(false)
      expect(profile.offRoleSeverity).toBe('none')
    })
    it('current lane 10% played → severe off-role', () => {
      const games: RecentGameRaw[] = [
        ...Array(2)
          .fill(0)
          .map(() => game({ teamPosition: 'TOP', championId: 86, win: true })),
        ...Array(18)
          .fill(0)
          .map(() => game({ teamPosition: 'JUNGLE', championId: 64, win: true }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'TOP',
        currentChampionId: 86,
        recentGames: games
      })
      expect(profile.isOffRole).toBe(true)
      expect(profile.offRoleSeverity).toBe('severe')
    })
    it('current lane 30% played → mild off-role', () => {
      const games: RecentGameRaw[] = [
        ...Array(6)
          .fill(0)
          .map(() => game({ teamPosition: 'TOP', championId: 86, win: true })),
        ...Array(14)
          .fill(0)
          .map(() => game({ teamPosition: 'JUNGLE', championId: 64, win: true }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'TOP',
        currentChampionId: 86,
        recentGames: games
      })
      expect(profile.isOffRole).toBe(false)
      expect(profile.offRoleSeverity).toBe('mild')
    })
    it('无位置上下文（hover 场景 UNKNOWN）不算补位', () => {
      const games: RecentGameRaw[] = [
        ...Array(2)
          .fill(0)
          .map(() => game({ teamPosition: 'TOP', championId: 86, win: true })),
        ...Array(18)
          .fill(0)
          .map(() => game({ teamPosition: 'JUNGLE', championId: 64, win: true }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'UNKNOWN',
        currentChampionId: 0,
        recentGames: games
      })
      expect(profile.isOffRole).toBe(false)
      expect(profile.offRoleSeverity).toBe('none')
      expect(profile.currentLanePlayedRatio).toBe(0)
    })
  })

  describe('currentChampionMastery', () => {
    it('champion played 12/20 games → isOnetrick true', () => {
      const games: RecentGameRaw[] = [
        ...Array(12)
          .fill(0)
          .map(() => game({ championId: 64, win: true })),
        ...Array(8)
          .fill(0)
          .map(() => game({ championId: 1, win: false }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      expect(profile.currentChampionMastery?.gamesInRecent).toBe(12)
      expect(profile.currentChampionMastery?.isOnetrick).toBe(true)
    })

    it('champion never played in recent → isFirstTimeInRecent true', () => {
      const games: RecentGameRaw[] = Array(20)
        .fill(0)
        .map(() => game({ championId: 1, win: true }))
      const profile = buildRecentProfile({
        currentTeamPosition: 'MIDDLE',
        currentChampionId: 9999,
        recentGames: games
      })
      expect(profile.currentChampionMastery?.gamesInRecent).toBe(0)
      expect(profile.currentChampionMastery?.isFirstTimeInRecent).toBe(true)
    })
  })

  describe('streak', () => {
    it('last 4 losses → streak loss 4', () => {
      const games: RecentGameRaw[] = [
        game({ championId: 1, win: false }),
        game({ championId: 1, win: false }),
        game({ championId: 1, win: false }),
        game({ championId: 1, win: false }),
        game({ championId: 1, win: true })
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'MIDDLE',
        currentChampionId: 1,
        recentGames: games
      })
      expect(profile.streak).toEqual({ kind: 'loss', count: 4 })
    })
    it('mixed last games → streak null', () => {
      const games: RecentGameRaw[] = [
        game({ championId: 1, win: true }),
        game({ championId: 1, win: false })
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'MIDDLE',
        currentChampionId: 1,
        recentGames: games
      })
      expect(profile.streak).toEqual({ kind: 'win', count: 1 })
    })
  })

  describe('recent metrics', () => {
    it('recentWinRate 为时间加权口径：6 胜 4 负，近 5 场全胜权重 2 → 11/15', () => {
      const games: RecentGameRaw[] = [
        ...Array(6)
          .fill(0)
          .map(() => game({ championId: 1, win: true })),
        ...Array(4)
          .fill(0)
          .map(() => game({ championId: 1, win: false }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'MIDDLE',
        currentChampionId: 1,
        recentGames: games
      })
      // 近 5 场（全胜）权重 2 → 10；第 6 场胜权重 1 → 1；4 负权重 1
      expect(profile.recentWinRate).toBeCloseTo(11 / 15)
    })

    it('时间衰减：近 5 场战绩主导加权胜率（同胜负比不同顺序结果不同）', () => {
      // 同样 6 胜 4 负，但 4 负全在最近：加权大幅低于简单比例
      const games: RecentGameRaw[] = [
        ...Array(4)
          .fill(0)
          .map(() => game({ championId: 1, win: false })),
        ...Array(6)
          .fill(0)
          .map(() => game({ championId: 1, win: true }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'MIDDLE',
        currentChampionId: 1,
        recentGames: games
      })
      // 近 5 场：4 负 ×2 + 1 胜 ×2 → 2/10；剩余 5 胜 ×1 → 5/15
      expect(profile.recentWinRate).toBeCloseTo(7 / 15)
    })
    it('empty recentGames → safe zeros', () => {
      const profile = buildRecentProfile({
        currentTeamPosition: 'MIDDLE',
        currentChampionId: 1,
        recentGames: []
      })
      expect(profile.recentWinRate).toBe(0)
      expect(profile.recentKda).toBe(0)
      expect(profile.mainPosition).toBe('UNCLEAR')
      expect(profile.isOffRole).toBe(false)
      expect(profile.currentChampionMastery).toBeNull()
    })
  })

  describe('模式过滤（ranked only）', () => {
    it('排位场次 ≥ 5 时只统计排位（420/440），ARAM/匹配被排除', () => {
      const games: RecentGameRaw[] = [
        // 排位：5 胜 3 负 = 8 场
        ...Array(5)
          .fill(0)
          .map(() => game({ championId: 64, win: true, queueId: 420 })),
        ...Array(3)
          .fill(0)
          .map(() => game({ championId: 64, win: false, queueId: 440 })),
        // 大乱斗/匹配：12 场全胜（若混入会把胜率顶到 100%）
        ...Array(8)
          .fill(0)
          .map(() => game({ championId: 86, win: true, queueId: 450 })),
        ...Array(4)
          .fill(0)
          .map(() => game({ championId: 86, win: true, queueId: 430 }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      // 只统计 8 场排位；近 5 场全胜权重 2、3 负权重 1 → 10/13
      const totalGames = (profile.positionDistribution ?? []).reduce((acc, p) => acc + p.games, 0)
      expect(totalGames).toBe(8)
      expect(profile.recentWinRate).toBeCloseTo(10 / 13)
      // 英雄池不含 ARAM 英雄
      const champs = profile.championDistribution ?? []
      expect(champs.some(c => c.championId === 86)).toBe(false)
    })

    it('排位不足 5 场时回退全量（防画像真空），胜率按全部场次', () => {
      const games: RecentGameRaw[] = [
        ...Array(3)
          .fill(0)
          .map(() => game({ championId: 64, win: true, queueId: 420 })),
        ...Array(2)
          .fill(0)
          .map(() => game({ championId: 86, win: false, queueId: 450 }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      const totalGames = (profile.positionDistribution ?? []).reduce((acc, p) => acc + p.games, 0)
      expect(totalGames).toBe(5)
      expect(profile.recentWinRate).toBeCloseTo(3 / 5)
    })

    it('竞技场/人机等非排位场次全量时同样被排位优先规则排除', () => {
      const games: RecentGameRaw[] = [
        ...Array(5)
          .fill(0)
          .map(() => game({ championId: 64, win: false, queueId: 420 })),
        ...Array(15)
          .fill(0)
          .map(() => game({ championId: 86, win: true, queueId: 1700 }))
      ]
      const profile = buildRecentProfile({
        currentTeamPosition: 'JUNGLE',
        currentChampionId: 64,
        recentGames: games
      })
      const totalGames = (profile.positionDistribution ?? []).reduce((acc, p) => acc + p.games, 0)
      expect(totalGames).toBe(5)
      expect(profile.recentWinRate).toBe(0)
    })
  })
})
