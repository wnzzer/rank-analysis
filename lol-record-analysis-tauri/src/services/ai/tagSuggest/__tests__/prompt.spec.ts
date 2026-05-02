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
  it('warns about the tautology anti-pattern', () => {
    expect(SYSTEM_PROMPT).toContain('套套逻辑')
  })
  it('includes good-tag few-shot example', () => {
    expect(SYSTEM_PROMPT).toContain('中路稳健')
  })
  it('includes bad-tag few-shot example', () => {
    expect(SYSTEM_PROMPT).toContain('暮气沉沉')
  })
  it('warns about mixing ranked and entertainment modes', () => {
    expect(SYSTEM_PROMPT).toContain('模式严格分开')
  })
  it('requires desc to match filter queue', () => {
    expect(SYSTEM_PROMPT).toContain('desc 必须与 filter 一致')
  })
  it('includes entertainment mode few-shot example', () => {
    expect(SYSTEM_PROMPT).toContain('乱斗豪强')
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
