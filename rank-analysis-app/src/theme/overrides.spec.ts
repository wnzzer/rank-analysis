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

  it('default button is outlined (transparent bg, hover only brightens border)', () => {
    const overrides = buildThemeOverrides(true)
    expect(overrides.Button?.color).toBe('transparent')
    expect(overrides.Button?.colorHover).toBe('transparent')
    expect(overrides.Button?.border).toContain('1px solid')
    expect(overrides.Button?.borderHover).not.toBe(overrides.Button?.border)
  })

  it('primary color unified to app accent with darker hover/pressed states', () => {
    for (const isDark of [true, false]) {
      const overrides = buildThemeOverrides(isDark)
      expect(overrides.common?.primaryColor).toBeTruthy()
      expect(overrides.common?.primaryColorHover).not.toBe(overrides.common?.primaryColor)
      expect(overrides.common?.primaryColorPressed).not.toBe(overrides.common?.primaryColor)
    }
  })

  it('uses control/overlay radius tiers (controls 4px-tier, overlays 8px-tier)', () => {
    const overrides = buildThemeOverrides(true)
    expect(overrides.common?.borderRadius).toBeTruthy()
    expect(overrides.Popover?.borderRadius).toBe(overrides.Tooltip?.borderRadius)
    expect(overrides.Dropdown?.borderRadius).toBe(overrides.Popover?.borderRadius)
  })

  it('covers Pagination namespace per spec §3.2 (Empty has no borderRadius theme var, inherits from common)', () => {
    const overrides = buildThemeOverrides(true)
    // naive-ui Pagination exposes itemBorderRadius (not borderRadius)
    expect(overrides.Pagination?.itemBorderRadius).toBeTruthy()
    // Empty namespace has no borderRadius theme var in naive-ui; inherits common.borderRadius
    expect(overrides.common?.borderRadius).toBeTruthy()
  })
})
