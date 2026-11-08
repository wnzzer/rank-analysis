/**
 * 基准查询回退、z 归一化、分位数工具与阈值查询回退。
 */
import { describe, it, expect } from 'vitest'
import { baselineQueue, cellKey, lookupStats, positionKey, type Baseline } from '../baseline'
import { localStats, zScore } from '../normalize'
import {
  DEFAULT_THRESHOLD,
  deciles,
  lookupThresholds,
  percentile,
  percentileBand,
  type ThresholdCell,
  type Thresholds
} from '../thresholds'

const B: Baseline = {
  meta: {
    builtAt: '',
    versions: [],
    sampleGames: 0,
    detailsGames: 0,
    perQueue: {},
    note: ''
  },
  cells: {
    '420|TOP|86': { n: 60, metrics: { gpm: { mean: 400, std: 50 } } },
    '420|TOP|*': { n: 500, metrics: { gpm: { mean: 410, std: 60 }, csm: { mean: 7, std: 1 } } },
    '420|*|*': { n: 2000, metrics: { dpm: { mean: 700, std: 200 } } },
    '450|*|*': { n: 900, metrics: { gpm: { mean: 900, std: 100 } } }
  }
}

describe('baseline lookup', () => {
  it('英雄格 → 位置格 → 队列格逐指标回退', () => {
    expect(lookupStats(B, 420, 'TOP', 86, true, 'gpm')).toEqual({ mean: 400, std: 50 })
    expect(lookupStats(B, 420, 'TOP', 86, true, 'csm')).toEqual({ mean: 7, std: 1 })
    expect(lookupStats(B, 420, 'TOP', 86, true, 'dpm')).toEqual({ mean: 700, std: 200 })
    expect(lookupStats(B, 420, 'TOP', 86, true, 'kda')).toBeNull()
  })

  it('无分路模式忽略位置；队列别名；未知队列为 null', () => {
    expect(lookupStats(B, 450, 'TOP', 86, false, 'gpm')).toEqual({ mean: 900, std: 100 })
    expect(lookupStats(B, 430, 'TOP', 86, true, 'gpm')).toEqual({ mean: 400, std: 50 })
    expect(lookupStats(B, 1700, 'TOP', 86, true, 'gpm')).toBeNull()
    expect(baselineQueue(440)).toBe(440)
    expect(positionKey('UNKNOWN', true)).toBe('*')
    expect(positionKey('TOP', false)).toBe('*')
    expect(cellKey(420, 'TOP', '*')).toBe('420|TOP|*')
  })
})

describe('zScore / localStats', () => {
  it('截断到 ±3，std 下限 1e-6', () => {
    expect(zScore(900, { mean: 1000, std: 100 })).toBeCloseTo(-1)
    expect(zScore(1500, { mean: 1000, std: 100 })).toBe(3)
    expect(zScore(700, { mean: 1000, std: 100 })).toBe(-3)
    expect(zScore(1000, { mean: 1000, std: 0 })).toBe(0)
    expect(zScore(1001, { mean: 1000, std: 0 })).toBe(3)
    expect(zScore(null, { mean: 0, std: 1 })).toBeNull()
    expect(zScore(1, null)).toBeNull()
  })

  it('本局相对比较：≥2 个有效值才给统计（总体标准差）', () => {
    const s = localStats([1, 2, 3, null])!
    expect(s.mean).toBeCloseTo(2)
    expect(s.std).toBeCloseTo(0.8165, 4)
    expect(localStats([5, null])).toBeNull()
  })
})

describe('percentiles', () => {
  it('线性插值分位数', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4)
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5], 0.8)).toBeCloseTo(4.2)
    expect(percentile([7], 0.3)).toBe(7)
  })

  it('十分位与分档', () => {
    const d = deciles([10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(d).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(percentileBand(0.5, d)).toBe('低于 P10')
    expect(percentileBand(1, d)).toBe('P10~P20')
    expect(percentileBand(5.5, d)).toBe('P50~P60')
    expect(percentileBand(9, d)).toBe('高于 P90')
  })
})

describe('lookupThresholds', () => {
  const cell = (n: number): ThresholdCell => ({ n, total: [n, n, n, n, n, n, n, n, n], sub: {} })
  const TH: Thresholds = {
    meta: { builtAt: '', sampleGames: 0 },
    cells: { '420|TOP|tl': cell(1), '420|*|notl': cell(2), '*|*|tl': cell(3) }
  }
  it('队列×位置×模式 → 队列×* → 同队列无时间线口径 → 全局 → 默认', () => {
    expect(lookupThresholds(TH, 420, 'TOP', true, true).n).toBe(1)
    expect(lookupThresholds(TH, 420, 'JUNGLE', true, true).n).toBe(2)
    expect(lookupThresholds(TH, 430, 'TOP', true, true).n).toBe(1)
    expect(lookupThresholds(TH, 9999, 'TOP', true, true).n).toBe(3)
    expect(lookupThresholds(TH, 9999, 'TOP', true, false)).toBe(DEFAULT_THRESHOLD)
  })
})
