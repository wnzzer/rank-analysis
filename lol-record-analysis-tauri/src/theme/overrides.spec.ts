import { describe, it, expect } from 'vitest'
import { buildThemeOverrides } from './overrides'

describe('buildThemeOverrides', () => {
  it('returns dark theme overrides with required namespaces', () => {
    const overrides = buildThemeOverrides(true)
    expect(overrides.common).toBeDefined()
    expect(overrides.Card).toBeDefined()
    expect(overrides.Button).toBeDefined()
    expect(overrides.Card?.borderRadius).toBeTruthy()
  })

  it('returns light theme overrides with required namespaces', () => {
    const overrides = buildThemeOverrides(false)
    expect(overrides.common).toBeDefined()
    expect(overrides.Card).toBeDefined()
    expect(overrides.Layout?.color).toBeTruthy()
  })

  it('isDark flag changes Layout.color', () => {
    const dark = buildThemeOverrides(true)
    const light = buildThemeOverrides(false)
    expect(dark.Layout?.color).not.toBe(light.Layout?.color)
  })

  it('covers Pagination namespace per spec §3.2 (Empty has no borderRadius theme var, inherits from common)', () => {
    const overrides = buildThemeOverrides(true)
    // naive-ui Pagination exposes itemBorderRadius (not borderRadius)
    expect(overrides.Pagination?.itemBorderRadius).toBeTruthy()
    // Empty namespace has no borderRadius theme var in naive-ui; inherits common.borderRadius
    expect(overrides.common?.borderRadius).toBeTruthy()
  })
})
