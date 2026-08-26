import { describe, it, expect } from 'vitest'
import { augmentRarityClass } from '../augment'

describe('augmentRarityClass', () => {
  it.each([
    ['kPrismatic', 'prismatic'],
    ['kGold', 'gold'],
    ['kSilver', 'silver'],
    ['kBronze', 'bronze']
  ])('maps %s to the prefixed rarity class', (rarity, suffix) => {
    expect(augmentRarityClass(rarity, 'record-card-augment')).toBe(`record-card-augment-${suffix}`)
  })

  it('falls back to the default class for unknown rarity', () => {
    expect(augmentRarityClass('kSomeNewRarity', 'match-detail-augment')).toBe(
      'match-detail-augment-default'
    )
  })

  it('falls back to the default class for undefined/empty rarity', () => {
    expect(augmentRarityClass(undefined, 'record-card-augment')).toBe('record-card-augment-default')
    expect(augmentRarityClass('', 'record-card-augment')).toBe('record-card-augment-default')
  })

  it('uses the caller-provided prefix verbatim', () => {
    expect(augmentRarityClass('kPrismatic', 'x')).toBe('x-prismatic')
  })
})
