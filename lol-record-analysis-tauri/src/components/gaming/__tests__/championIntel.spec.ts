import { describe, it, expect } from 'vitest'
import { pickStateClass, tierBadge, formatWinRate } from '../championIntel'

describe('championIntel helpers', () => {
  it('pickStateClass 四态映射与兜底', () => {
    expect(pickStateClass('locked')).toBe('intel-locked')
    expect(pickStateClass('picking')).toBe('intel-picking')
    expect(pickStateClass('intent')).toBe('intel-intent')
    expect(pickStateClass(undefined)).toBe('intel-none')
    expect(pickStateClass('')).toBe('intel-none')
  })
  it('tierBadge 边界', () => {
    expect(tierBadge(1).label).toBe('T1')
    expect(tierBadge(0).label).toBe('')
    expect(tierBadge(5).label).toBe('T5')
  })
  it('formatWinRate', () => {
    expect(formatWinRate(0.5183)).toBe('51.8%')
    expect(formatWinRate(0)).toBe('--')
    expect(formatWinRate(undefined)).toBe('--')
  })
})
