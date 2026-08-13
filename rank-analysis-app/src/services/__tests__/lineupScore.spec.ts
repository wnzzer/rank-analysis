import { describe, it, expect } from 'vitest'

import {
  computeLineupScore,
  EMPTY_LINEUP_SCORE,
  toLineupInputs,
  type LineupScoreInput
} from '../lineupScore'
import type { ChampionMeta } from '../opgg'

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
    expect(s).toEqual({ score: null, covered: 0, total: 2, bestTier: null })
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
