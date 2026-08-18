import { describe, it, expect } from 'vitest'

import {
  computeLineupScore,
  computeMatchupHints,
  EMPTY_LINEUP_SCORE,
  playerLineupAdjustment,
  toLineupInputs,
  type LineupScoreInput
} from '../lineupScore'
import type { ChampionMeta } from '@renderer/services/opgg'
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
    expect(s).toEqual({
      score: null,
      covered: 0,
      total: 2,
      bestTier: null,
      playerAdjusted: false,
      breakdown: []
    })
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
      positionChampionDistribution: [],
      currentChampionMastery: null,
      recentWinRate: 0.5,
      recentKda: 3,
      streak: null,
      isOffRole: false,
      offRoleSeverity: 'none',
      ...overrides
    }
  }

  it('20 场 60% 胜率（收缩后 56.7%）→ +0.02；45% → -0.01', () => {
    const hot = playerLineupAdjustment(profile({ recentWinRate: 0.6 }))
    expect(hot.adjustment).toBeCloseTo(0.02, 3)
    expect(hot.playerRate).toBeCloseTo(17 / 30, 3) // (12+5)/(20+10)
    expect(hot.reasons).toContain('近期胜率 57%')

    const cold = playerLineupAdjustment(profile({ recentWinRate: 0.45 }))
    expect(cold.adjustment).toBeCloseTo(-0.01, 3)
    expect(cold.reasons).toContain('近期胜率 47%')
  })

  it('小样本收缩：5 场全胜只 +0.05（旧版 +0.10），不放大噪声', () => {
    const r = playerLineupAdjustment(
      profile({ positionDistribution: [{ pos: 'JUNGLE', ratio: 1, games: 5 }], recentWinRate: 1 })
    )
    expect(r.playerRate).toBeCloseTo(10 / 15, 3) // (5+5)/(5+10) ≈ 0.667
    expect(r.adjustment).toBeCloseTo(0.05, 3)
  })

  it('样本越大越接近原始胜率：50 场 60% 收缩后 ≈ 58.3%', () => {
    const r = playerLineupAdjustment(
      profile({
        positionDistribution: [{ pos: 'JUNGLE', ratio: 1, games: 50 }],
        recentWinRate: 0.6
      })
    )
    expect(r.playerRate).toBeCloseTo(35 / 60, 3) // (30+5)/(50+10)
    expect(r.adjustment).toBeCloseTo(0.025, 3)
  })

  it('绝活 +0.02；近期首次使用 -0.02（叠加在胜率偏移上）', () => {
    const onetrick = playerLineupAdjustment(
      profile({
        recentWinRate: 0.5,
        currentChampionMastery: {
          gamesInRecent: 12,
          winRate: 0.6,
          avgKda: 4,
          isOnetrick: true,
          isFirstTimeInRecent: false
        }
      })
    )
    expect(onetrick.adjustment).toBeCloseTo(0.02, 3)
    expect(onetrick.reasons).toContain('绝活')

    const first = playerLineupAdjustment(
      profile({
        recentWinRate: 0.5,
        currentChampionMastery: {
          gamesInRecent: 0,
          winRate: 0,
          avgKda: 0,
          isOnetrick: false,
          isFirstTimeInRecent: true
        }
      })
    )
    expect(first.adjustment).toBeCloseTo(-0.02, 3)
    expect(first.reasons).toContain('近期首次使用')
  })

  it('补位 severe -0.02 / mild -0.01 / none 0', () => {
    const severe = playerLineupAdjustment(
      profile({ recentWinRate: 0.5, isOffRole: true, offRoleSeverity: 'severe' })
    )
    expect(severe.adjustment).toBeCloseTo(-0.02, 3)
    expect(severe.reasons).toContain('严重补位')

    const mild = playerLineupAdjustment(profile({ recentWinRate: 0.5, offRoleSeverity: 'mild' }))
    expect(mild.adjustment).toBeCloseTo(-0.01, 3)
    expect(mild.reasons).toContain('补位')

    const none = playerLineupAdjustment(profile({ recentWinRate: 0.5, offRoleSeverity: 'none' }))
    expect(none.adjustment).toBeCloseTo(0, 3)
    expect(none.reasons).toEqual([])
  })

  it('无近期对局（total 0）→ 空结果，不按 recentWinRate 0 惩罚', () => {
    const empty = playerLineupAdjustment(
      profile({
        positionDistribution: [],
        recentWinRate: 0
      })
    )
    expect(empty).toEqual({ playerRate: null, adjustment: 0, reasons: [] })
  })
})

describe('computeLineupScore with player profiles', () => {
  function profile(recentWinRate: number, mastery?: RecentPlayerProfile['currentChampionMastery']) {
    return {
      positionDistribution: [{ pos: 'JUNGLE' as const, ratio: 1, games: 20 }],
      mainPosition: 'JUNGLE' as const,
      currentLanePlayedRatio: 1,
      championDistribution: [] as RecentPlayerProfile['championDistribution'],
      positionChampionDistribution: [] as RecentPlayerProfile['positionChampionDistribution'],
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
    expect(s.score).toBe(52.0) // base 50 + 收缩后 56.7% 偏离的 30% 权重 = 2 分
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
    // base 50 + (0.7667-0.5)*0.3*100(8) + 绝活 2 = 60；clamp 防止推到 90+ 的失真区间
    expect(s.score).toBe(60.0)
  })

  it('clamp 生效：极端 meta 胜率被限制在 [30, 70]', () => {
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
    expect(s.score).toBe(30.0)
  })

  it('无画像（profile null / 缺省）→ 原行为不变', () => {
    const withProfile = computeLineupScore([{ championId: 1, meta: meta(1, 0.5).meta }])
    const withNull = computeLineupScore([{ championId: 1, meta: meta(1, 0.5).meta, profile: null }])
    expect(withProfile).toEqual(withNull)
    expect(withProfile.score).toBe(50.0)
    expect(withProfile.playerAdjusted).toBe(false)
  })

  it('breakdown：覆盖英雄带 base/玩家/调整后胜率与理由；未覆盖不在明细里', () => {
    const s = computeLineupScore([
      { championId: 1, meta: meta(1, 0.5).meta, profile: profile(0.6) },
      { championId: 2, meta: meta(2, 0.53).meta },
      { championId: 3, meta: null }
    ])
    expect(s.breakdown).toHaveLength(2)
    expect(s.breakdown[0]).toEqual({
      championId: 1,
      baseWinRate: 50,
      playerWinRate: 56.7, // 17/30
      adjustedWinRate: 52,
      reasons: ['近期胜率 57%']
    })
    expect(s.breakdown[1]).toEqual({
      championId: 2,
      baseWinRate: 53,
      playerWinRate: null,
      adjustedWinRate: 53,
      reasons: []
    })
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

describe('computeMatchupHints', () => {
  it('同分路画像均值差 ≥2%：输出优势/劣势行', () => {
    const hints = computeMatchupHints(
      [
        { position: 'JUNGLE', rate: 0.58 },
        { position: 'TOP', rate: 0.45 }
      ],
      [
        { position: 'JUNGLE', rate: 0.5 },
        { position: 'TOP', rate: 0.55 }
      ]
    )
    expect(hints).toHaveLength(2)
    expect(hints.some(h => h.includes('打野') && h.includes('我方优势 +8%'))).toBe(true)
    expect(hints.some(h => h.includes('上单') && h.includes('敌方优势 -10%'))).toBe(true)
  })

  it('差距 <2% 时不输出（对位相当不制造噪音）', () => {
    const hints = computeMatchupHints(
      [{ position: 'MIDDLE', rate: 0.51 }],
      [{ position: 'MIDDLE', rate: 0.5 }]
    )
    expect(hints).toEqual([])
  })

  it('无画像（rate null）按 0.5 中性计；敌方缺该分路时跳过', () => {
    const hints = computeMatchupHints(
      [{ position: 'JUNGLE', rate: null }],
      [{ position: 'BOTTOM', rate: 0.7 }]
    )
    expect(hints).toEqual([])
  })

  it('分路为空/未知不参与配对；最多 3 行且按差距降序', () => {
    const hints = computeMatchupHints(
      [
        { position: 'JUNGLE', rate: 0.8 },
        { position: 'TOP', rate: 0.2 },
        { position: 'MIDDLE', rate: 0.7 },
        { position: 'BOTTOM', rate: 0.65 },
        { position: '', rate: 0.9 }
      ],
      [
        { position: 'JUNGLE', rate: 0.5 },
        { position: 'TOP', rate: 0.5 },
        { position: 'MIDDLE', rate: 0.5 },
        { position: 'BOTTOM', rate: 0.5 },
        { position: 'UNKNOWN', rate: 0.9 }
      ]
    )
    expect(hints).toHaveLength(3)
    const joined = hints.join('\n')
    expect(joined).toContain('上单')
    expect(joined).toContain('敌方优势 -30%')
    expect(joined).toContain('打野')
    expect(joined).toContain('我方优势 +30%')
    expect(joined).not.toContain('BOTTOM')
  })
})
