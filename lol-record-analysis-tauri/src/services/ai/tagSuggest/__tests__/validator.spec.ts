import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseAndValidate } from '../validator'

const STUB_UUID = '00000000-0000-4000-8000-000000000000'
let originalRandomUUID: typeof crypto.randomUUID | undefined

beforeEach(() => {
  originalRandomUUID = crypto.randomUUID?.bind(crypto)
  crypto.randomUUID = vi.fn(() => STUB_UUID)
})

afterEach(() => {
  if (originalRandomUUID) crypto.randomUUID = originalRandomUUID
})

describe('parseAndValidate', () => {
  function suggestion(overrides: Partial<{ name: string; desc: string }> = {}) {
    return {
      name: '中路雕将',
      desc: '中路场均 KDA 高',
      condition: {
        type: 'history',
        filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
        refresh: { type: 'count', op: '>=', value: 5 }
      },
      ...overrides
    }
  }

  it('extracts wrapped json from markdown fences', () => {
    const raw = '```json\n{"good":[],"bad":[]}\n```'
    const r = parseAndValidate(raw)
    expect(r.good).toEqual([])
    expect(r.bad).toEqual([])
  })

  it('drops entry whose name is too short', () => {
    const raw = JSON.stringify({ good: [suggestion({ name: '中' })], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(0)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry whose name is too long', () => {
    const raw = JSON.stringify({ good: [suggestion({ name: '中路雕将猛人' })], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry missing condition', () => {
    const bad = { name: '中路雕将', desc: 'x' } // no condition
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry with invalid TagCondition variant', () => {
    const bad = suggestion()
    bad.condition = { type: 'bogusVariant' } as never
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry with invalid Operator string', () => {
    const bad = suggestion()
    ;(bad.condition as any).filters[0].op = 'GTE' // wrong (should be ">=")
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('preserves valid entries from a mixed batch', () => {
    const raw = JSON.stringify({
      good: [suggestion(), suggestion({ name: '中' })],
      bad: [suggestion()]
    })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
    expect(r.bad).toHaveLength(1)
    expect(r.droppedCount).toBe(1)
  })

  it('throws on JSON parse failure', () => {
    expect(() => parseAndValidate('not json')).toThrow()
  })

  it('throws when payload lacks good/bad arrays', () => {
    expect(() => parseAndValidate('{"foo": []}')).toThrow()
  })

  it('fills good=true/false based on which array the entry came from', () => {
    const raw = JSON.stringify({ good: [suggestion()], bad: [suggestion()] })
    const r = parseAndValidate(raw)
    expect(r.good[0].good).toBe(true)
    expect(r.bad[0].good).toBe(false)
  })

  it('generates id (uuid) and sets isDefault=false / enabled=true', () => {
    const raw = JSON.stringify({ good: [suggestion()], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good[0].id).toBe(STUB_UUID)
    expect(r.good[0].isDefault).toBe(false)
    expect(r.good[0].enabled).toBe(true)
  })

  // MatchRefresh variant coverage (I-3)

  it('drops entry with average refresh missing metric', () => {
    const bad = suggestion()
    ;(bad.condition as any).refresh = { type: 'average', op: '>=', value: 5 } // no metric
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('accepts streak refresh with valid kind', () => {
    const ok = suggestion()
    ;(ok.condition as any).refresh = { type: 'streak', min: 3, kind: 'loss' }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
    expect(r.droppedCount).toBe(0)
  })

  it('drops streak refresh with uppercase kind (Rust expects lowercase)', () => {
    const bad = suggestion()
    ;(bad.condition as any).refresh = { type: 'streak', min: 3, kind: 'WIN' }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  // Recursive TagCondition coverage (I-4)

  it('accepts nested and(history, currentQueue)', () => {
    const validHistory = {
      type: 'history',
      filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
      refresh: { type: 'count', op: '>=', value: 3 }
    }
    const validQueue = { type: 'currentQueue', ids: [420] }
    const ok = suggestion()
    ;(ok.condition as any) = { type: 'and', conditions: [validHistory, validQueue] }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  it('drops and-condition where any nested condition is invalid', () => {
    const validHistory = {
      type: 'history',
      filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
      refresh: { type: 'count', op: '>=', value: 3 }
    }
    const bad = suggestion()
    ;(bad.condition as any) = {
      type: 'and',
      conditions: [validHistory, { type: 'bogus' }]
    }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops not-condition wrapping a non-condition value', () => {
    const bad = suggestion()
    ;(bad.condition as any) = { type: 'not', condition: 'oops' }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops history with filter/refresh tautology (same metric + same op)', () => {
    const bad = suggestion()
    ;(bad.condition as any) = {
      type: 'history',
      filters: [{ type: 'stat', metric: 'gold', op: '>=', value: 12000 }],
      refresh: { type: 'average', metric: 'gold', op: '>=', value: 12000 },
    }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('accepts history where filter and refresh use different metrics', () => {
    const ok = suggestion()
    ;(ok.condition as any) = {
      type: 'history',
      filters: [{ type: 'stat', metric: 'gold', op: '>=', value: 12000 }],
      refresh: { type: 'average', metric: 'damage', op: '>=', value: 25000 },
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  it('accepts history where filter and refresh use opposite directions', () => {
    // filter "gold >= 8000" + refresh "average gold <= 12000" — different op → 不是套套逻辑
    const ok = suggestion()
    ;(ok.condition as any) = {
      type: 'history',
      filters: [{ type: 'stat', metric: 'gold', op: '>=', value: 8000 }],
      refresh: { type: 'average', metric: 'gold', op: '<=', value: 12000 },
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })
})
