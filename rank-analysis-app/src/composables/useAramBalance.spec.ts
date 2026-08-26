import { describe, it, expect } from 'vitest'
import { buildBalanceTags, summarizeBalanceStatus, type AramBalanceData } from './useAramBalance'

describe('buildBalanceTags', () => {
  it('returns empty for null/undefined data', () => {
    expect(buildBalanceTags(null)).toEqual([])
    expect(buildBalanceTags(undefined)).toEqual([])
  })

  it('returns empty when all modifiers sit within the ±0.001 dead zone', () => {
    const b: AramBalanceData = { dmg_dealt: 1.0009, dmg_taken: 0.9991 }
    expect(buildBalanceTags(b)).toEqual([])
  })

  it('marks increased outgoing damage as a buff', () => {
    const [tag] = buildBalanceTags({ dmg_dealt: 1.15 })
    expect(tag).toMatchObject({
      label: '输出 +15%',
      desc: '造成伤害修正',
      type: 'success',
      isBuff: true
    })
  })

  it('marks reduced damage taken as a buff (inverse polarity)', () => {
    const [tag] = buildBalanceTags({ dmg_taken: 0.9 })
    expect(tag).toMatchObject({
      label: '承伤 -10%',
      type: 'success',
      isBuff: true
    })
  })

  it('marks increased damage taken as a nerf', () => {
    const [tag] = buildBalanceTags({ dmg_taken: 1.05 })
    expect(tag).toMatchObject({
      label: '承伤 +5%',
      type: 'error',
      isBuff: false
    })
  })

  it('emits healing and shielding percent tags', () => {
    const tags = buildBalanceTags({ healing: 0.8, shielding: 1.2 })
    expect(tags.map(t => t.label)).toEqual(['治疗 -20%', '护盾 +20%'])
  })

  it('emits a flat ability haste tag with sign and skips zero', () => {
    expect(buildBalanceTags({ ability_haste: 20 })).toMatchObject([
      { label: '急速 +20', type: 'success', isBuff: true }
    ])
    expect(buildBalanceTags({ ability_haste: -10 })).toMatchObject([
      { label: '急速 -10', type: 'error', isBuff: false }
    ])
    expect(buildBalanceTags({ ability_haste: 0 })).toEqual([])
  })

  it('ignores non-number modifier values', () => {
    const b = { dmg_dealt: undefined, healing: undefined } as AramBalanceData
    expect(buildBalanceTags(b)).toEqual([])
  })
})

describe('summarizeBalanceStatus', () => {
  it('is balanced when no tags', () => {
    expect(summarizeBalanceStatus([])).toEqual({ label: '平衡', type: 'default' })
  })

  it('leans buff when buffs outnumber nerfs', () => {
    const tags = buildBalanceTags({ dmg_dealt: 1.2, dmg_taken: 0.9, healing: 0.8 })
    // 输出+承伤为增益，治疗为削减 → 2 vs 1
    expect(summarizeBalanceStatus(tags)).toEqual({ label: '增强', type: 'success' })
  })

  it('leans nerf when nerfs outnumber buffs', () => {
    const tags = buildBalanceTags({ dmg_dealt: 0.9, dmg_taken: 1.2 })
    expect(summarizeBalanceStatus(tags)).toEqual({ label: '削弱', type: 'error' })
  })

  it('reports mixed adjustments on tie', () => {
    const tags = buildBalanceTags({ dmg_dealt: 1.2, dmg_taken: 1.2 })
    expect(summarizeBalanceStatus(tags)).toEqual({ label: '调整', type: 'warning' })
  })
})
