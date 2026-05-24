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
}): RecentGameRaw {
  return {
    teamPosition: opts.teamPosition ?? 'JUNGLE',
    championId: opts.championId,
    win: opts.win,
    kills: opts.k ?? 5,
    deaths: opts.d ?? 3,
    assists: opts.a ?? 7
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
    it('recentWinRate counts win=true / total', () => {
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
      expect(profile.recentWinRate).toBeCloseTo(0.6, 2)
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
})
