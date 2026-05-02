import { describe, it, expect } from 'vitest'
import { buildTagSuggestPrompt, SYSTEM_PROMPT } from '../prompt'

describe('SYSTEM_PROMPT', () => {
  it('embeds the full TagCondition schema reference', () => {
    expect(SYSTEM_PROMPT).toContain('"type": "history"')
    expect(SYSTEM_PROMPT).toContain('"type": "currentQueue"')
    expect(SYSTEM_PROMPT).toContain('"type": "stat"')
  })
  it('embeds the Operator string symbols', () => {
    expect(SYSTEM_PROMPT).toContain('">="')
    expect(SYSTEM_PROMPT).toContain('"<"')
  })
  it('mentions the 2-5 character name constraint', () => {
    expect(SYSTEM_PROMPT).toContain('2-5')
  })
  it('demands strict JSON output without markdown', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('json')
    expect(SYSTEM_PROMPT).toContain('good')
    expect(SYSTEM_PROMPT).toContain('bad')
  })
})

describe('buildTagSuggestPrompt', () => {
  it('reports the actual N for wins and losses', () => {
    const wins = [{ win: true } as any, { win: true } as any]
    const losses = [{ win: false } as any]
    const p = buildTagSuggestPrompt(wins, losses)
    expect(p).toContain('赢局 (N=2)')
    expect(p).toContain('输局 (N=1)')
  })
  it('handles N=0 wins (all losses)', () => {
    const p = buildTagSuggestPrompt([], [{ win: false } as any])
    expect(p).toContain('赢局 (N=0)')
  })
  it('embeds JSON of features, not raw text', () => {
    const wins = [{ win: true, championId: 157, kda: { ratio: 5 } } as any]
    const p = buildTagSuggestPrompt(wins, [])
    expect(p).toContain('"championId": 157')
    expect(p).toContain('"ratio": 5')
  })
})
