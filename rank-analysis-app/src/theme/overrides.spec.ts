import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildThemeOverrides, readRootToken } from './overrides'

/** 与 global.css 暗色取值一致的最小 token 表（只含 overrides 读取的键） */
const DARK: Record<string, string> = {
  '--radius-control': '4px',
  '--radius-xs': '3px',
  '--radius-overlay': '8px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
  '--radius-pill': '999px',
  '--space-8': '8px',
  '--space-12': '12px',
  '--font-size-base': '13px',
  '--bg-base': '#0d0d0f',
  '--surface-card': 'rgba(255, 255, 255, 0.05)',
  '--surface-input': 'rgba(255, 255, 255, 0.05)',
  '--glass-bg-mid': 'rgba(255, 255, 255, 0.05)',
  '--glass-border': 'rgba(255, 255, 255, 0.09)',
  '--shadow-md': '0 2px 8px rgba(0, 0, 0, 0.45)',
  '--semantic-win': '#3d9b7a',
  '--accent-hover': '#378b6e',
  '--accent-pressed': '#317c62',
  '--focus-ring-soft': 'rgba(61, 155, 122, 0.35)',
  '--text-primary': 'rgba(255, 255, 255, 0.92)',
  '--border-control': 'rgba(255, 255, 255, 0.16)',
  '--border-control-hover': 'rgba(255, 255, 255, 0.34)',
  '--menu-item-active': 'rgba(61, 155, 122, 0.14)',
  '--menu-item-active-hover': 'rgba(61, 155, 122, 0.18)'
}
const read = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? ''

describe('buildThemeOverrides', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps surface / accent / menu tokens onto naive keys', () => {
    const o = buildThemeOverrides(read(DARK))
    expect(o.Layout?.color).toBe('#0d0d0f')
    expect(o.Card?.color).toBe('rgba(255, 255, 255, 0.05)')
    expect(o.Card?.borderColor).toBe('rgba(255, 255, 255, 0.09)')
    expect(o.Card?.boxShadow).toBe('0 2px 8px rgba(0, 0, 0, 0.45)')
    expect(o.Input?.color).toBe('rgba(255, 255, 255, 0.05)')
    expect(o.Input?.boxShadowFocus).toBe('0 0 0 2px rgba(61, 155, 122, 0.35)')
    expect(o.common?.primaryColor).toBe('#3d9b7a')
    expect(o.common?.primaryColorHover).toBe('#378b6e')
    expect(o.common?.primaryColorPressed).toBe('#317c62')
    expect(o.Menu?.itemColorActive).toBe('rgba(61, 155, 122, 0.14)')
    expect(o.Menu?.itemColorActiveHover).toBe('rgba(61, 155, 122, 0.18)')
  })

  it('follows whatever theme the tokens currently hold', () => {
    const light = buildThemeOverrides(
      read({ ...DARK, '--bg-base': '#f1f3f5', '--surface-card': '#ffffff' })
    )
    expect(light.Layout?.color).toBe('#f1f3f5')
    expect(light.Card?.color).toBe('#ffffff')
  })

  it('default button is outlined (transparent bg, hover only brightens border)', () => {
    const o = buildThemeOverrides(read(DARK))
    expect(o.Button?.color).toBe('transparent')
    expect(o.Button?.colorHover).toBe('transparent')
    expect(o.Button?.border).toBe('1px solid rgba(255, 255, 255, 0.16)')
    expect(o.Button?.borderHover).toBe('1px solid rgba(255, 255, 255, 0.34)')
  })

  it('uses control/overlay radius tiers (controls 4px-tier, overlays 8px-tier)', () => {
    const o = buildThemeOverrides(read(DARK))
    expect(o.common?.borderRadius).toBe('4px')
    expect(o.Popover?.borderRadius).toBe(o.Tooltip?.borderRadius)
    expect(o.Dropdown?.borderRadius).toBe(o.Popover?.borderRadius)
    expect(o.Pagination?.itemBorderRadius).toBe('4px')
  })

  it('reads tokens from <html> by default (trimmed)', () => {
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--bg-base' ? ' #010203 ' : '')
    } as unknown as CSSStyleDeclaration)
    expect(readRootToken('--bg-base')).toBe('#010203')
    expect(spy).toHaveBeenCalledWith(document.documentElement)
  })
})
