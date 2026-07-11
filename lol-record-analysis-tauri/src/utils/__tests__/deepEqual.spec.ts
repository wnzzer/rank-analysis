import { describe, it, expect } from 'vitest'
import { deepEqual } from '../deepEqual'

describe('deepEqual', () => {
  it('原始值与 null/undefined', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual('a', 'b')).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual(0, false)).toBe(false)
  })

  it('对象键序无关', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('数组按序比较', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual([1], { 0: 1 })).toBe(false)
  })

  it('配置快照实战形状({value:...} 包装嵌套)', () => {
    const a = { theme: { value: 'dark' }, 'settings.auto.pickChampionSlice': { value: [1, 2] } }
    const b = { 'settings.auto.pickChampionSlice': { value: [1, 2] }, theme: { value: 'dark' } }
    expect(deepEqual(a, b)).toBe(true)
    expect(deepEqual(a, { ...b, theme: { value: 'light' } })).toBe(false)
  })
})
