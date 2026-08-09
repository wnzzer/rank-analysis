import { describe, it, expect } from 'vitest'
import { hasNoExecutableTarget } from '../autoBpHint'

describe('hasNoExecutableTarget', () => {
  it('开关开着且规则与兜底池都空 → 提示', () => {
    expect(hasNoExecutableTarget(true, [], [])).toBe(true)
  })

  it('开关关着 → 不提示，配置没配完不是问题', () => {
    expect(hasNoExecutableTarget(false, [], [])).toBe(false)
  })

  it('有启用中的规则 → 不提示，只在特定局面动手是合理配置', () => {
    expect(hasNoExecutableTarget(true, [{ enabled: true }], [])).toBe(false)
  })

  it('规则全被停用等同没有规则 → 仍提示', () => {
    expect(hasNoExecutableTarget(true, [{ enabled: false }], [])).toBe(true)
  })

  it('有兜底池 → 不提示，没规则只有兜底池是合理配置', () => {
    expect(hasNoExecutableTarget(true, [], [64])).toBe(false)
  })

  it('规则与兜底池都有 → 不提示', () => {
    expect(hasNoExecutableTarget(true, [{ enabled: true }], [64])).toBe(false)
  })
})
