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
})
