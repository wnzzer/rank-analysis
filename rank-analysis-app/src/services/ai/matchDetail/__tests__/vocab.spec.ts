import { describe, it, expect } from 'vitest'
import { GOOD_VOCAB } from '../../tagSuggest/vocab/good'
import { BAD_VOCAB } from '../../tagSuggest/vocab/bad'
import { PERMANENT_BANNED_NAMES } from '../../tagSuggest/validator'
import { sampleCritiqueVocab } from '../vocab'

const ALL_WORDS: Set<string> = new Set([
  ...Object.values(GOOD_VOCAB),
  ...Object.values(BAD_VOCAB)
].flat())

describe('sampleCritiqueVocab', () => {
  it('默认采样 30-50 词，全部来自好+坏词库', () => {
    const words = sampleCritiqueVocab()
    expect(words.length).toBeGreaterThanOrEqual(30)
    expect(words.length).toBeLessThanOrEqual(50)
    for (const w of words) {
      expect(ALL_WORDS.has(w)).toBe(true)
    }
  })

  it('过滤永久禁用词（送葬人/carry王/演员王/送人头）', () => {
    // 大样本多轮采样，确保任何一轮都不含禁用词
    for (let i = 0; i < 20; i++) {
      const words = sampleCritiqueVocab({ seed: i })
      for (const banned of PERMANENT_BANNED_NAMES) {
        expect(words.some(w => w.includes(banned))).toBe(false)
      }
    }
  })

  it('无重复词', () => {
    const words = sampleCritiqueVocab({ seed: 7 })
    expect(new Set(words).size).toBe(words.length)
  })

  it('同 seed 结果确定，可重放', () => {
    expect(sampleCritiqueVocab({ seed: 42 })).toEqual(sampleCritiqueVocab({ seed: 42 }))
    expect(sampleCritiqueVocab({ seed: 42 })).not.toEqual(sampleCritiqueVocab({ seed: 43 }))
  })

  it('count 选项生效', () => {
    const words = sampleCritiqueVocab({ count: 10, seed: 1 })
    expect(words.length).toBe(10)
  })
})
