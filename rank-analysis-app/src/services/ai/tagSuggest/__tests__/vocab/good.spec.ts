import { describe, it, expect } from 'vitest'
import { GOOD_VOCAB } from '../../vocab/good'

const PERMANENT_BANNED = ['送葬人', 'carry王', '演员王', '送人头']

describe('GOOD_VOCAB', () => {
  it('has all 5 categories', () => {
    expect(Object.keys(GOOD_VOCAB).sort()).toEqual(
      ['acerbic', 'carry', 'classical', 'meta', 'resilient'].sort()
    )
  })

  it('each category has ≥15 entries', () => {
    for (const [cat, words] of Object.entries(GOOD_VOCAB)) {
      expect(words.length, `category ${cat} length`).toBeGreaterThanOrEqual(15)
    }
  })

  it('contains zero permanent-banned words', () => {
    for (const [cat, words] of Object.entries(GOOD_VOCAB)) {
      for (const w of words) {
        for (const banned of PERMANENT_BANNED) {
          expect(w, `${cat}: word "${w}" contains banned "${banned}"`).not.toContain(banned)
        }
      }
    }
  })

  it('all words are 2-7 Chinese characters', () => {
    for (const [cat, words] of Object.entries(GOOD_VOCAB)) {
      for (const w of words) {
        const len = Array.from(w).length
        expect(len, `${cat} "${w}" length`).toBeGreaterThanOrEqual(2)
        expect(len, `${cat} "${w}" length`).toBeLessThanOrEqual(7)
      }
    }
  })

  it('has no duplicates within a category', () => {
    for (const [cat, words] of Object.entries(GOOD_VOCAB)) {
      const set = new Set(words)
      expect(set.size, `${cat} has dup`).toBe(words.length)
    }
  })

  it('includes a few known spec exemplars', () => {
    expect(GOOD_VOCAB.acerbic).toContain('严谨逆风千里')
    expect(GOOD_VOCAB.carry).toContain('屠夫')
    expect(GOOD_VOCAB.resilient).toContain('铁布衫')
    expect(GOOD_VOCAB.classical).toContain('逆风千里')
    expect(GOOD_VOCAB.meta).toContain('微操王者')
  })
})
