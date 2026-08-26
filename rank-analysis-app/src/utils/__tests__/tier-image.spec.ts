import { describe, it, expect } from 'vitest'
import { tierImage } from '../tier-image'
import unranked from '@renderer/assets/imgs/tier/unranked.png'
import gold from '@renderer/assets/imgs/tier/gold.png'
import emerald from '@renderer/assets/imgs/tier/emerald.png'

describe('tierImage', () => {
  it('maps known tiers to their icon assets', () => {
    expect(tierImage('gold')).toBe(gold)
    expect(tierImage('emerald')).toBe(emerald)
  })

  it('is case-insensitive', () => {
    expect(tierImage('GOLD')).toBe(gold)
    expect(tierImage('GrandMaster')).toBe(tierImage('grandmaster'))
  })

  it('falls back to unranked for undefined/empty/unknown tiers', () => {
    expect(tierImage(undefined)).toBe(unranked)
    expect(tierImage('')).toBe(unranked)
    expect(tierImage('not-a-tier')).toBe(unranked)
  })
})
