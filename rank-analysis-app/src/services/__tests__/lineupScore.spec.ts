import { describe, it, expect } from 'vitest'

import {
  computeLineupScore,
  EMPTY_LINEUP_SCORE,
  playerLineupAdjustment,
  toLineupInputs,
  type LineupScoreInput
} from '../lineupScore'
import type { ChampionMeta } from '../opgg'
import type { RecentPlayerProfile } from '@renderer/services/ai/shared/types'

function meta(id: number, winRate: number, tier = 1): { championId: number; meta: ChampionMeta } {
  return {
    championId: id,
    meta: {
      championId: id,
      position: '',
      tier,
      rank: 1,
      rankPrevPatch: 0,
      winRate,
      pickRate: 0,
      banRate: 0,
      roleRate: 0,
      isMainPosition: false
    }
  }
}

describe('computeLineupScore', () => {
  it('按覆盖英雄胜率均值出分，1 位小数', () => {
    const input: LineupScoreInput[] = [
      meta(1, 0.5),
      meta(2, 0.53),
      meta(3, 0.57),
      { championId: 4, meta: null },
      { championId: 5, meta: null }
    ]
    const s = computeLineupScore(input)
    expect(s.score).toBe(53.3) // (50+53+57)/3 = 53.333
    expect(s.covered).toBe(3)
    expect(s.total).toBe(5)
  })

  it('bestTier 取覆盖英雄中最小值（数字小=强）', () => {
    const s = computeLineupScore([meta(1, 0.5, 1), meta(2, 0.5, 3), meta(3, 0.5, 2)])
    expect(s.bestTier).toBe(1)
  })

  it('全无数据 → score null / bestTier null，covered 0', () => {
    const s = computeLineupScore([
      { championId: 1, meta: null },
      { championId: 2, meta: null }
    ])
    expect(s).toEqual({ score: null, covered: 0, total: 2, bestTier: null, playerAdjusted: false })
  })

  it('空阵容 → EMPTY_LINEUP_SCORE 等价结果', () => {
    expect(computeLineupScore([])).toEqual(EMPTY_LINEUP_SCORE)
  })

  it('tier 为 0（无数据）的 meta 不算覆盖 bestTier，但仍计入胜率', () => {
    const s = computeLineupScore([meta(1, 0.5, 0), meta(2, 0.53, 2)])
    expect(s.covered).toBe(2)
    expect(s.score).toBe(51.5)
    expect(s.bestTier).toBe(2)
  })
})

describe('playerLineupAdjustment', () => {
  function profile(overrides: Partial<RecentPlayerProfile>): RecentPlayerProfile {
    return {
      positionDistribution: [{ pos: 'JUNGLE', ratio: 1, games: 20 }],
      mainPosition: 'JUNGLE',
      currentLanePlayedRatio: 1,
      championDistribution: [],
      currentChampionMastery: null,
      recentWinRate: 0.5,
      recentKda: 3,
      streak: null,
      isOffRole: false,
      offRoleSeverity: 'none',
      ...overrides
    }
  }

  it('60% 胜率 → +0.02；45% 胜率 → -0.01', () => {
    expect(playerLineupAdjustment(profile({ recentWinRate: 0.6 }))).toBeCloseTo(0.02, 3)
    expect(playerLineupAdjustment(profile({ recentWinRate: 0.45 }))).toBeCloseTo(-0.01, 3)
  })

  it('绝活 +0.02；近期首次使用 -0.02（叠加在胜率偏移上）', () => {
    const onetrick = profile({
      recentWinRate: 0.5,
      currentChampionMastery: {
        gamesInRecent: 12,
        winRate: 0.6,
        avgKda: 4,
        isOnetrick: true,
        isFirstTimeInRecent: false
      }
    })
    expect(playerLineupAdjustment(onetrick)).toBeCloseTo(0.02, 3)

    const first = profile({
      recentWinRate: 0.5,
      currentChampionMastery: {
        gamesInRecent: 0,
        winRate: 0,
        avgKda: 0,
        isOnetrick: false,
        isFirstTimeInRecent: true
      }
    })
    expect(playerLineupAdjustment(first)).toBeCloseTo(-0.02, 3)
  })

  it('补位 severe -0.02 / mild -0.01 / none 0', () => {
    expect(
      playerLineupAdjustment(
        profile({ recentWinRate: 0.5, isOffRole: true, offRoleSeverity: 'severe' })
      )
    ).toBeCloseTo(-0.02, 3)
    expect(
      playerLineupAdjustment(profile({ recentWinRate: 0.5, offRoleSeverity: 'mild' }))
    ).toBeCloseTo(-0.01, 3)
    expect(
      playerLineupAdjustment(profile({ recentWinRate: 0.5, offRoleSeverity: 'none' }))
    ).toBeCloseTo(0, 3)
  })

  it('无近期对局（total 0）→ 0，不按 recentWinRate 0 惩罚', () => {
    const empty = profile({
      positionDistribution: [],
      recentWinRate: 0
    })
    expect(playerLineupAdjustment(empty)).toBe(0)
  })
})

describe('computeLineupScore with player profiles', () => {
  function profile(recentWinRate: number, mastery?: RecentPlayerProfile['currentChampionMastery']) {
    return {
      positionDistribution: [{ pos: 'JUNGLE' as const, ratio: 1, games: 20 }],
      mainPosition: 'JUNGLE' as const,
      currentLanePlayedRatio: 1,
      championDistribution: [] as RecentPlayerProfile['championDistribution'],
      currentChampionMastery: mastery ?? null,
      recentWinRate,
      recentKda: 3,
      streak: null,
      isOffRole: false,
      offRoleSeverity: 'none' as const
    }
  }

  it('有画像时按玩家胜率加权出分，playerAdjusted=true', () => {
    const input: LineupScoreInput[] = [
      { championId: 1, meta: meta(1, 0.5).meta, profile: profile(0.6) }
    ]
    const s = computeLineupScore(input)
    expect(s.score).toBe(52.0) // (50 + 2) / 1
    expect(s.playerAdjusted).toBe(true)
  })

  it('加权后分数在合理区间：极端画像不把分数推到全赢区间', () => {
    const input: LineupScoreInput[] = [
      {
        championId: 1,
        meta: meta(1, 0.5).meta,
        profile: profile(0.9, {
          gamesInRecent: 20,
          winRate: 0.95,
          avgKda: 10,
          isOnetrick: true,
          isFirstTimeInRecent: false
        })
      }
    ]
    const s = computeLineupScore(input)
    // base 50 + (0.9-0.5)*0.2*100(8) + 绝活 2 = 60；clamp 防止推到 90+ 的失真区间
    expect(s.score).toBe(60.0)
  })

  it('clamp 生效：极端 meta 胜率被限制在 [25, 85]', () => {
    const input: LineupScoreInput[] = [
      {
        championId: 1,
        meta: meta(1, 0.05).meta,
        profile: profile(0.9, {
          gamesInRecent: 20,
          winRate: 0.95,
          avgKda: 10,
          isOnetrick: true,
          isFirstTimeInRecent: false
        })
      }
    ]
    const s = computeLineupScore(input)
    expect(s.score).toBe(25.0)
  })

  it('无画像（profile null / 缺省）→ 原行为不变', () => {
    const withProfile = computeLineupScore([{ championId: 1, meta: meta(1, 0.5).meta }])
    const withNull = computeLineupScore([{ championId: 1, meta: meta(1, 0.5).meta, profile: null }])
    expect(withProfile).toEqual(withNull)
    expect(withProfile.score).toBe(50.0)
    expect(withProfile.playerAdjusted).toBe(false)
  })
})

describe('toLineupInputs', () => {
  it('按 id 数组顺序对齐 metaById（缺的给 null）', () => {
    const byId = new Map([
      [2, meta(2, 0.5).meta],
      [3, meta(3, 0.55).meta]
    ])
    const inputs = toLineupInputs([1, 2, 3], byId)
    expect(inputs.map(i => i.championId)).toEqual([1, 2, 3])
    expect(inputs[0].meta).toBeNull()
    expect(inputs[1].meta?.winRate).toBe(0.5)
    expect(inputs[2].meta?.winRate).toBe(0.55)
  })

  it('空 id 数组 → 空输入', () => {
    expect(toLineupInputs([], new Map())).toEqual([])
  })
})
