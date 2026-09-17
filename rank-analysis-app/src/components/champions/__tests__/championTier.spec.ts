import { describe, it, expect } from 'vitest'
import {
  filterRows,
  notableTrend,
  sortRows,
  toRows,
  trendOf,
  TREND_MIN_DELTA
} from '../championTier'
import type { ChampionMeta } from '@renderer/services/opgg'

function meta(
  championId: number,
  position: string,
  overrides: Partial<ChampionMeta> = {}
): ChampionMeta {
  return {
    championId,
    position,
    tier: 2,
    rank: 10,
    rankPrevPatch: 10,
    winRate: 0.5,
    pickRate: 0.1,
    banRate: 0.02,
    roleRate: 0.6,
    isMainPosition: true,
    ...overrides
  }
}

const NAMES: Record<number, string> = { 86: '盖伦', 157: '亚索', 412: '锤石' }
const nameOf = (id: number) => NAMES[id] ?? `英雄${id}`
const textsOf = (id: number) =>
  ({ 86: ['盖伦', '德玛西亚之力', 'gl'], 157: ['亚索', '疾风剑豪', 'yasuo'] })[id] ?? []

describe('trendOf', () => {
  it('上版本排名更靠后 = 这版本走强', () => {
    expect(trendOf(5, 8)).toEqual({ dir: 'up', delta: 3 })
  })

  it('上版本排名更靠前 = 走弱', () => {
    expect(trendOf(8, 5)).toEqual({ dir: 'down', delta: 3 })
  })

  it('持平与无上版本数据分开表达', () => {
    expect(trendOf(5, 5)).toEqual({ dir: 'flat', delta: 0 })
    expect(trendOf(5, 0)).toEqual({ dir: 'none', delta: 0 })
  })
})

describe('toRows', () => {
  const metas = [
    meta(157, 'MIDDLE', { tier: 2, rank: 15 }),
    meta(157, 'TOP', { isMainPosition: false, tier: 3, rank: 40 }),
    meta(86, 'TOP', { tier: 1, rank: 2 })
  ]

  it('只返回该分路的行，含非主分路的条目', () => {
    const rows = toRows(metas, 'TOP', nameOf)
    expect(rows.map(r => [r.championId, r.tier])).toEqual([
      [157, 3],
      [86, 1]
    ])
  })

  it('同一英雄的其他分路不出现', () => {
    const rows = toRows(metas, 'MIDDLE', nameOf)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('亚索')
    expect(rows[0].rank).toBe(15)
  })

  it('这条路一个英雄都没有时给空数组', () => {
    expect(toRows(metas, 'UTILITY', nameOf)).toEqual([])
  })

  it('带上趋势，供表格直接渲染', () => {
    const rows = toRows([meta(86, 'TOP', { rank: 2, rankPrevPatch: 6 })], 'TOP', nameOf)
    expect(rows[0].trend).toEqual({ dir: 'up', delta: 4 })
  })
})

describe('notableTrend', () => {
  it('阈值就是 5 名', () => {
    expect(TREND_MIN_DELTA).toBe(5)
  })

  it('挪动不到阈值的当噪音丢掉', () => {
    expect(notableTrend({ dir: 'up', delta: 4 })).toBeNull()
    expect(notableTrend({ dir: 'down', delta: 4 })).toBeNull()
  })

  it('够阈值的原样返回', () => {
    expect(notableTrend({ dir: 'up', delta: 5 })).toEqual({ dir: 'up', delta: 5 })
    expect(notableTrend({ dir: 'down', delta: 23 })).toEqual({ dir: 'down', delta: 23 })
  })

  it('持平与无数据都没得标', () => {
    expect(notableTrend({ dir: 'flat', delta: 0 })).toBeNull()
    expect(notableTrend({ dir: 'none', delta: 0 })).toBeNull()
  })
})

describe('filterRows', () => {
  const rows = toRows([meta(86, 'TOP'), meta(157, 'TOP')], 'TOP', nameOf)

  it('空关键词返回全部', () => {
    expect(filterRows(rows, '', textsOf)).toHaveLength(2)
    expect(filterRows(rows, '  ', textsOf)).toHaveLength(2)
  })

  it('名字 / 称号 / 别名都能搜到', () => {
    expect(filterRows(rows, '亚索', textsOf).map(r => r.championId)).toEqual([157])
    expect(filterRows(rows, '德玛西亚', textsOf).map(r => r.championId)).toEqual([86])
    expect(filterRows(rows, 'YASUO', textsOf).map(r => r.championId)).toEqual([157])
  })

  it('搜不到时为空', () => {
    expect(filterRows(rows, '不存在的英雄', textsOf)).toEqual([])
  })
})

describe('sortRows', () => {
  const rows = toRows(
    [
      meta(1, 'TOP', { tier: 2, rank: 5, winRate: 0.53, pickRate: 0.02, banRate: 0.3 }),
      meta(2, 'TOP', { tier: 1, rank: 9, winRate: 0.49, pickRate: 0.2, banRate: 0.01 }),
      meta(3, 'TOP', { tier: 2, rank: 1, winRate: 0.51, pickRate: 0.1, banRate: 0.05 })
    ],
    'TOP',
    nameOf
  )

  it('默认按 T 级、同级按同分路排名', () => {
    expect(sortRows(rows, 'default', false).map(r => r.championId)).toEqual([2, 3, 1])
  })

  it('按胜率 / 登场率 / Ban 率降序', () => {
    expect(sortRows(rows, 'winRate', true).map(r => r.championId)).toEqual([1, 3, 2])
    expect(sortRows(rows, 'pickRate', true).map(r => r.championId)).toEqual([2, 3, 1])
    expect(sortRows(rows, 'banRate', true).map(r => r.championId)).toEqual([1, 3, 2])
  })

  it('升序可用，且不改动入参数组', () => {
    const before = rows.map(r => r.championId)
    expect(sortRows(rows, 'winRate', false).map(r => r.championId)).toEqual([2, 3, 1])
    expect(rows.map(r => r.championId)).toEqual(before)
  })
})
