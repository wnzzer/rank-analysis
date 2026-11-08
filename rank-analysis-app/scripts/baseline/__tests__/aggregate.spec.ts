/** 基准累加器与 Pearson 相关 */
import { describe, it, expect } from 'vitest'
import { addSample, finalizeCells, pearson, type Accumulator } from '../aggregate'

describe('aggregate', () => {
  it('均值与总体标准差；缺失值不计入指标样本', () => {
    const acc: Accumulator = new Map()
    addSample(acc, ['a', 'b'], { gpm: 1 })
    addSample(acc, ['a', 'b'], { gpm: 3 })
    addSample(acc, ['a'], { gpm: null })
    expect(finalizeCells(acc, 2).a).toEqual({ n: 3, metrics: { gpm: { mean: 2, std: 1 } } })
    expect(finalizeCells(acc, 3).a).toEqual({ n: 3, metrics: {} })
    expect(finalizeCells(acc, 3).b).toBeUndefined()
    expect(finalizeCells(acc, 4).a).toBeUndefined()
  })

  it('pearson', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1)
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0)
  })
})
