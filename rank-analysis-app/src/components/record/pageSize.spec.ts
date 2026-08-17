import { describe, it, expect } from 'vitest'
import {
  computePageSize,
  PAGE_OVERHEAD_PX,
  PAGE_ROW_PX,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN
} from './pageSize'

describe('computePageSize', () => {
  it('fixed 模式返回手动条数', () => {
    expect(computePageSize(800, 'fixed', 7)).toBe(7)
    expect(computePageSize(600, 'fixed', 10)).toBe(10)
  })

  it('fixed 模式最小为 1', () => {
    expect(computePageSize(800, 'fixed', 0)).toBe(1)
    expect(computePageSize(800, 'fixed', -3)).toBe(1)
  })

  it('fixed 模式下 viewport 高度不影响结果', () => {
    expect(computePageSize(2000, 'fixed', 5)).toBe(5)
  })

  it('auto 模式按可视高度动态计算', () => {
    const expected = Math.floor((800 - PAGE_OVERHEAD_PX) / PAGE_ROW_PX)
    expect(computePageSize(800, 'auto', 10)).toBe(expected)
  })

  it('auto 模式忽略 fixedSize 参数', () => {
    expect(computePageSize(800, 'auto', 1)).toBe(computePageSize(800, 'auto', 30))
  })

  it('auto 模式下限 clamp 到 PAGE_SIZE_MIN', () => {
    expect(computePageSize(PAGE_OVERHEAD_PX - 100, 'auto', 10)).toBe(PAGE_SIZE_MIN)
  })

  it('auto 模式上限 clamp 到 PAGE_SIZE_MAX', () => {
    expect(computePageSize(99999, 'auto', 10)).toBe(PAGE_SIZE_MAX)
  })

  it('auto 模式条数随高度单调不减', () => {
    const small = computePageSize(600, 'auto', 10)
    const large = computePageSize(1600, 'auto', 10)
    expect(large).toBeGreaterThanOrEqual(small)
    expect(large).toBeLessThanOrEqual(PAGE_SIZE_MAX)
  })
})
