import { describe, it, expect } from 'vitest'
import {
  pickStateClass,
  playerCardPickStateClass,
  tierBadge,
  formatWinRate,
  isChampionSwap
} from '../championIntel'

describe('championIntel helpers', () => {
  it('pickStateClass 五态映射与兜底', () => {
    expect(pickStateClass('locked')).toBe('intel-locked')
    expect(pickStateClass('picking')).toBe('intel-picking')
    expect(pickStateClass('banning')).toBe('intel-banning')
    expect(pickStateClass('intent')).toBe('intel-intent')
    expect(pickStateClass(undefined)).toBe('intel-none')
    expect(pickStateClass('')).toBe('intel-none')
  })
  it('playerCardPickStateClass 四态映射，none/空/未知值一律不加类', () => {
    expect(playerCardPickStateClass('intent')).toBe('pc-intent')
    expect(playerCardPickStateClass('picking')).toBe('pc-picking')
    expect(playerCardPickStateClass('banning')).toBe('pc-banning')
    expect(playerCardPickStateClass('locked')).toBe('pc-locked')
    expect(playerCardPickStateClass('none')).toBe('')
    expect(playerCardPickStateClass('')).toBe('')
    expect(playerCardPickStateClass(undefined)).toBe('')
  })
  it('tierBadge 边界', () => {
    expect(tierBadge(1).label).toBe('T1')
    expect(tierBadge(0).label).toBe('')
    expect(tierBadge(5).label).toBe('T5')
  })
  it('tierBadge 返回 pill chip 背景色，tier 0 时全空', () => {
    expect(tierBadge(1).bg).toContain('var(--semantic-win)')
    expect(tierBadge(2).bg).toContain('var(--accent-blue)')
    expect(tierBadge(0)).toEqual({ label: '', color: '', bg: '' })
  })
  it('formatWinRate', () => {
    expect(formatWinRate(0.5183)).toBe('51.8%')
    expect(formatWinRate(0)).toBe('--')
    expect(formatWinRate(undefined)).toBe('--')
  })
  it('isChampionSwap 仅在新旧 championId 均为正数且不相等时判定为真换人', () => {
    expect(isChampionSwap(1, 2)).toBe(true)
    expect(isChampionSwap(1, 1)).toBe(false)
    expect(isChampionSwap(0, 1)).toBe(false)
    expect(isChampionSwap(undefined, 1)).toBe(false)
    expect(isChampionSwap(1, 0)).toBe(false)
    expect(isChampionSwap(1, undefined)).toBe(false)
    expect(isChampionSwap(undefined, undefined)).toBe(false)
  })
})
