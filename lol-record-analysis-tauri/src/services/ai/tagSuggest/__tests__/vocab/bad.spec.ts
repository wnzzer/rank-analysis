import { describe, it, expect } from 'vitest'
import { BAD_VOCAB } from '../../vocab/bad'

const PERMANENT_BANNED = ['送葬人', 'carry王', '演员王', '送人头']

describe('BAD_VOCAB', () => {
  it('has all 5 categories', () => {
    expect(Object.keys(BAD_VOCAB).sort()).toEqual(
      ['acerbic', 'classical', 'floppy', 'meta', 'theatrical'].sort()
    )
  })

  it('each category has ≥15 entries', () => {
    for (const [cat, words] of Object.entries(BAD_VOCAB)) {
      expect(words.length, `category ${cat} length`).toBeGreaterThanOrEqual(15)
    }
  })

  it('contains zero permanent-banned words', () => {
    for (const [cat, words] of Object.entries(BAD_VOCAB)) {
      for (const w of words) {
        for (const banned of PERMANENT_BANNED) {
          expect(w, `${cat}: word "${w}" contains banned "${banned}"`).not.toContain(banned)
        }
      }
    }
  })

  it('all words are 2-7 Chinese characters', () => {
    for (const [cat, words] of Object.entries(BAD_VOCAB)) {
      for (const w of words) {
        const len = Array.from(w).length
        expect(len, `${cat} "${w}" length`).toBeGreaterThanOrEqual(2)
        expect(len, `${cat} "${w}" length`).toBeLessThanOrEqual(7)
      }
    }
  })

  it('has no duplicates within a category', () => {
    for (const [cat, words] of Object.entries(BAD_VOCAB)) {
      const set = new Set(words)
      expect(set.size, `${cat} has dup`).toBe(words.length)
    }
  })

  it('includes a few known spec exemplars', () => {
    expect(BAD_VOCAB.acerbic).toContain('咸鱼')
    expect(BAD_VOCAB.floppy).toContain('翻车王')
    expect(BAD_VOCAB.theatrical).toContain('演技派')
    expect(BAD_VOCAB.classical).toContain('暮气沉沉')
    expect(BAD_VOCAB.meta).toContain('死亡音乐')
  })
})
