import { describe, it, expect } from 'vitest'
import { parseStage1, parseStage2, PERMANENT_BANNED_NAMES } from '../validator'

const goodCandidate = {
  id: 'g1',
  metric: 'kda',
  queueIds: [420, 440],
  direction: '>=',
  threshold: 4.5,
  countMin: 5,
  evidence: '排位 KDA≥4.5 共 6 局',
  vibe: ['carry']
}

const badCandidate = {
  id: 'b1',
  metric: 'streak',
  queueIds: [420, 440],
  direction: 'loss',
  threshold: 0,
  countMin: 3,
  evidence: '近 3 场连败',
  vibe: ['暮气']
}

function profile(overrides: Record<string, unknown> = {}): unknown {
  return {
    styleSummary: '该玩家擅长野区控制',
    modeBreakdown: [
      {
        queueIds: [420, 440],
        queueName: '单双排位',
        winSignals: ['KDA 高'],
        lossSignals: ['对线崩'],
        sampleSize: 12
      }
    ],
    goodCandidates: [
      goodCandidate,
      { ...goodCandidate, id: 'g2' },
      { ...goodCandidate, id: 'g3' },
      { ...goodCandidate, id: 'g4' }
    ],
    badCandidates: [
      badCandidate,
      { ...badCandidate, id: 'b2' },
      { ...badCandidate, id: 'b3' },
      { ...badCandidate, id: 'b4' }
    ],
    ...overrides
  }
}

describe('parseStage1', () => {
  it('parses a valid JSON ProfileSummary', () => {
    const raw = JSON.stringify(profile())
    const r = parseStage1(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.goodCandidates).toHaveLength(4)
      expect(r.value.badCandidates).toHaveLength(4)
    }
  })

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(profile()) + '\n```'
    expect(parseStage1(raw).ok).toBe(true)
  })

  it('fails on non-JSON', () => {
    const r = parseStage1('hello world')
    expect(r.ok).toBe(false)
  })

  it('fails when goodCandidates < 4', () => {
    const r = parseStage1(JSON.stringify(profile({ goodCandidates: [goodCandidate] })))
    expect(r.ok).toBe(false)
  })

  it('fails when badCandidates < 4', () => {
    const r = parseStage1(JSON.stringify(profile({ badCandidates: [badCandidate] })))
    expect(r.ok).toBe(false)
  })

  it('fails when a candidate metric is not whitelisted', () => {
    const r = parseStage1(
      JSON.stringify(
        profile({
          goodCandidates: [
            { ...goodCandidate, metric: 'bogus' },
            { ...goodCandidate, id: 'g2' },
            { ...goodCandidate, id: 'g3' },
            { ...goodCandidate, id: 'g4' }
          ]
        })
      )
    )
    expect(r.ok).toBe(false)
  })

  it('fails when modeBreakdown is missing', () => {
    const raw = JSON.stringify(profile({ modeBreakdown: undefined }))
    expect(parseStage1(raw).ok).toBe(false)
  })

  it('streak candidate with direction loss is accepted', () => {
    const r = parseStage1(JSON.stringify(profile()))
    expect(r.ok).toBe(true)
  })

  it('streak candidate with operator direction (not win|loss) is rejected', () => {
    const bad = { ...badCandidate, direction: '>=' }
    const r = parseStage1(
      JSON.stringify(
        profile({
          badCandidates: [bad, { ...bad, id: 'b2' }, { ...bad, id: 'b3' }, { ...bad, id: 'b4' }]
        })
      )
    )
    expect(r.ok).toBe(false)
  })

  it('countMin must be ≥ 1', () => {
    const r = parseStage1(
      JSON.stringify(
        profile({
          goodCandidates: [
            { ...goodCandidate, countMin: 0 },
            { ...goodCandidate, id: 'g2' },
            { ...goodCandidate, id: 'g3' },
            { ...goodCandidate, id: 'g4' }
          ]
        })
      )
    )
    expect(r.ok).toBe(false)
  })
})

describe('parseStage2', () => {
  function naming(overrides: Record<string, unknown> = {}): unknown {
    return {
      good: [
        { id: 'g1', name: '雕花匠', desc: '排位 KDA≥4.5 至少 5 局' },
        { id: 'g2', name: '夜枭', desc: '大乱斗伤害高 至少 5 局' },
        { id: 'g3', name: '佛系输出位', desc: '排位高输出 至少 5 局' }
      ],
      bad: [
        { id: 'b1', name: '暮气', desc: '排位近 3 场连败' },
        { id: 'b2', name: '咸鱼', desc: '大乱斗参团率低 至少 5 局' },
        { id: 'b3', name: '翻车王', desc: '排位高死亡 至少 5 局' }
      ],
      skipped: ['g4', 'b4'],
      ...overrides
    }
  }

  it('parses a valid Stage 2 NamingResult', () => {
    const r = parseStage2(JSON.stringify(naming()))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.good).toHaveLength(3)
      expect(r.value.bad).toHaveLength(3)
      expect(r.value.skipped).toEqual(['g4', 'b4'])
    }
  })

  it('PERMANENT_BANNED_NAMES contains the spec list', () => {
    expect(PERMANENT_BANNED_NAMES).toContain('送葬人')
    expect(PERMANENT_BANNED_NAMES).toContain('carry王')
    expect(PERMANENT_BANNED_NAMES).toContain('演员王')
    expect(PERMANENT_BANNED_NAMES).toContain('送人头')
  })

  it('rejects entry whose name contains a permanent-banned substring', () => {
    const r = parseStage2(
      JSON.stringify(
        naming({
          good: [
            { id: 'g1', name: '排位送葬人', desc: 'x' },
            { id: 'g2', name: '夜枭', desc: 'x' },
            { id: 'g3', name: '雕花匠', desc: 'x' }
          ]
        })
      )
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      // The banned entry is dropped; only 2 remain
      expect(r.value.good).toHaveLength(2)
    }
  })

  it('rejects entry with name < 2 chars', () => {
    const r = parseStage2(
      JSON.stringify(
        naming({
          good: [
            { id: 'g1', name: '王', desc: 'x' },
            { id: 'g2', name: '夜枭', desc: 'x' },
            { id: 'g3', name: '雕花匠', desc: 'x' }
          ]
        })
      )
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.good).toHaveLength(2)
  })

  it('rejects entry with name > 7 chars', () => {
    const r = parseStage2(
      JSON.stringify(
        naming({
          good: [
            { id: 'g1', name: '排位顶级独行侠王', desc: 'x' }, // 8 chars
            { id: 'g2', name: '夜枭', desc: 'x' },
            { id: 'g3', name: '雕花匠', desc: 'x' }
          ]
        })
      )
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.good).toHaveLength(2)
  })

  it('rejects entry with empty desc', () => {
    const r = parseStage2(
      JSON.stringify(
        naming({
          good: [
            { id: 'g1', name: '雕花匠', desc: '' },
            { id: 'g2', name: '夜枭', desc: 'x' },
            { id: 'g3', name: '佛系输出位', desc: 'x' }
          ]
        })
      )
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.good).toHaveLength(2)
  })

  it('fails on non-JSON', () => {
    expect(parseStage2('definitely not json').ok).toBe(false)
  })

  it('fails when good or bad is not an array', () => {
    expect(parseStage2(JSON.stringify({ good: {}, bad: [], skipped: [] })).ok).toBe(false)
  })

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(naming()) + '\n```'
    expect(parseStage2(raw).ok).toBe(true)
  })

  it('treats missing skipped as []', () => {
    const r = parseStage2(JSON.stringify(naming({ skipped: undefined })))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.skipped).toEqual([])
  })
})
