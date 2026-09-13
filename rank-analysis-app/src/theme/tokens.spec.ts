/**
 * global.css token 守门：新增语义 token / 效果开关必须两主题成对；
 * 供 naive 覆盖读取的 token 必须是字面色值（color-mix / var 会让 naive 颜色运算报错）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../global.css'), 'utf8')

function block(selectorPattern: RegExp): string {
  const m = css.match(selectorPattern)
  if (!m) throw new Error(`block not found: ${selectorPattern}`)
  return m[1]
}
function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim().replace(/\s+/g, ' ')
  }
  return out
}
const dark = tokens(block(/:root,\s*\.theme-light \.n-tooltip\s*\{([\s\S]*?)\n\}/))
const light = tokens(block(/\n\.theme-light\s*\{([\s\S]*?)\n\}/))

const PAIRED = [
  '--surface-card',
  '--surface-input',
  '--surface-sunken',
  '--sunken-border',
  '--sunken-shadow',
  '--surface-control',
  '--surface-group',
  '--surface-shell',
  '--surface-sidebar',
  '--shell-header-shadow',
  '--panel-glass-bg',
  '--panel-glass-shadow',
  '--track-bg',
  '--progress-rail',
  '--stat-dot-empty',
  '--accent-hover',
  '--accent-pressed',
  '--focus-ring-soft',
  '--menu-item-active',
  '--menu-item-active-hover',
  '--settings-menu-active-bg',
  '--detail-header-bg',
  '--detail-team-card-bg',
  '--detail-team-card-shadow',
  '--detail-column-header-bg',
  '--detail-row-me-bg',
  '--fx-glow',
  '--fx-wash',
  '--fx-ambient'
]
const READ_BY_NAIVE = [
  '--bg-base',
  '--surface-card',
  '--surface-input',
  '--glass-bg-mid',
  '--glass-border',
  '--semantic-win',
  '--accent-hover',
  '--accent-pressed',
  '--focus-ring-soft',
  '--text-primary',
  '--border-control',
  '--border-control-hover',
  '--menu-item-active',
  '--menu-item-active-hover'
]
const LITERAL_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i

describe('global.css tokens', () => {
  it.each(PAIRED)('%s is defined for both themes', name => {
    expect(dark[name], `${name} 缺暗色值`).toBeDefined()
    expect(light[name], `${name} 缺亮色值`).toBeDefined()
  })

  it.each(READ_BY_NAIVE)('%s is a literal color in both themes', name => {
    expect(dark[name]).toMatch(LITERAL_COLOR)
    expect(light[name]).toMatch(LITERAL_COLOR)
  })

  it('effect switches are 1 in dark and 0 in light', () => {
    for (const name of ['--fx-glow', '--fx-wash', '--fx-ambient']) {
      expect(dark[name]).toBe('1')
      expect(light[name]).toBe('0')
    }
  })

  it('keeps no light-only material patches for panels / groups / shell', () => {
    expect(css).not.toMatch(
      /\.theme-light \.(panel-glass|subteam-card|n-layout-header|n-layout-sider)/
    )
  })
})
