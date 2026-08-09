import { describe, it, expect } from 'vitest'
import { sampleVocab } from '../../vocab/sampler'
import { GOOD_VOCAB } from '../../vocab/good'
import { BAD_VOCAB } from '../../vocab/bad'

describe('sampleVocab', () => {
  it('returns ~30-50 words by default', () => {
    const out = sampleVocab(GOOD_VOCAB)
    expect(out.length).toBeGreaterThanOrEqual(30)
    expect(out.length).toBeLessThanOrEqual(50)
  })

  it('returns exactly N when count is specified', () => {
    const out = sampleVocab(GOOD_VOCAB, { count: 25 })
    expect(out.length).toBe(25)
  })

  it('all returned words exist in the source vocab', () => {
    const allGood: Set<string> = new Set(Object.values(GOOD_VOCAB).flat() as string[])
    const out = sampleVocab(GOOD_VOCAB, { count: 30 })
    for (const w of out) {
      expect(allGood.has(w)).toBe(true)
    }
  })

  it('no duplicates in the sample', () => {
    const out = sampleVocab(GOOD_VOCAB, { count: 40 })
    expect(new Set(out).size).toBe(out.length)
  })

  it('different seeds produce different samples', () => {
    const a = sampleVocab(GOOD_VOCAB, { count: 30, seed: 1 })
    const b = sampleVocab(GOOD_VOCAB, { count: 30, seed: 2 })
    // It's astronomically unlikely two seeded shuffles are identical
    expect(a.join('|')).not.toBe(b.join('|'))
  })

  it('same seed produces same sample (deterministic)', () => {
    const a = sampleVocab(GOOD_VOCAB, { count: 30, seed: 42 })
    const b = sampleVocab(GOOD_VOCAB, { count: 30, seed: 42 })
    expect(a).toEqual(b)
  })

  it('represents every category in a 40-word sample', () => {
    const out = sampleVocab(GOOD_VOCAB, { count: 40, seed: 7 })
    const set = new Set(out)
    for (const cat of Object.keys(GOOD_VOCAB) as Array<keyof typeof GOOD_VOCAB>) {
      const catWords = GOOD_VOCAB[cat] as readonly string[]
      const hits = catWords.filter(w => set.has(w))
      expect(hits.length, `category ${cat} should have ≥1 hit`).toBeGreaterThanOrEqual(1)
    }
  })

  it('works with BAD_VOCAB too', () => {
    const out = sampleVocab(BAD_VOCAB, { count: 30 })
    expect(out.length).toBe(30)
  })

  it('count greater than corpus is clamped to corpus size', () => {
    const tiny = { only: ['a', 'b', 'c'] as const }
    const out = sampleVocab(tiny, { count: 100 })
    expect(out.length).toBe(3)
  })
})
