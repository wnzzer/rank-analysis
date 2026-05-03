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
    const raw = JSON.stringify({ good: [suggestion({ name: '排位顶级独行侠王' })], bad: [] }) // 8 chars
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('accepts entry with 7-char name (new max)', () => {
    const ok = suggestion({ name: '排位顶级独行侠' }) // 7 chars
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  it('accepts entry with 6-char name', () => {
    const ok = suggestion({ name: '乱斗大咆哮王' }) // 6 chars
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
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
      refresh: { type: 'average', metric: 'gold', op: '>=', value: 12000 }
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
      refresh: { type: 'average', metric: 'damage', op: '>=', value: 25000 }
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
      refresh: { type: 'average', metric: 'gold', op: '<=', value: 12000 }
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  // desc / queue-scope consistency checks

  it('drops entry where desc says 排位 but filter is entertainment-only', () => {
    const bad = suggestion({ desc: '排位中路 KDA 高' })
    ;(bad.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [1300] }], // 觉醒之战
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry where desc says 排位 but filter mixes ranked and entertainment', () => {
    const bad = suggestion({ desc: '排位玩 carry' })
    ;(bad.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [420, 450] }], // mixes ranked + ARAM
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('accepts entry where desc says 排位 and filter is ranked-only', () => {
    const ok = suggestion({ desc: '排位中路 KDA ≥5' })
    ;(ok.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [420, 440] }],
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  it('accepts entry where desc names entertainment mode and filter matches', () => {
    const ok = suggestion({ name: '乱斗咆哮王', desc: '大乱斗伤害王' }) // name has no lane word
    ;(ok.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [450] }],
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  it('accepts entry without queue filter (desc unconstrained)', () => {
    const ok = suggestion({ desc: '不分模式高 KDA' })
    ;(ok.condition as any) = {
      type: 'history',
      filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  // lane-word checks (非 SR 模式禁路位词)

  it('drops entry where filter is all-entertainment but name contains lane word', () => {
    const bad = suggestion({ name: '乱斗中路王' }) // contains 中路, 5 chars
    ;(bad.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [450] }],
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry where filter is all-entertainment but desc contains lane word', () => {
    const bad = suggestion({ desc: '海克斯乱斗打野场均输出高' })
    ;(bad.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [450] }],
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('accepts entry where mixed ranked + entertainment uses lane word', () => {
    const ok = suggestion({ name: '中路稳健', desc: '中路场均 KDA ≥5' })
    ;(ok.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [420, 450] }], // mixed
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  it('accepts ranked-only entry with lane word in name', () => {
    const ok = suggestion({ name: '排位中路雕', desc: '排位中路 KDA ≥5' })
    ;(ok.condition as any) = {
      type: 'history',
      filters: [{ type: 'queue', ids: [420, 440] }],
      refresh: { type: 'count', op: '>=', value: 5 }
    }
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })

  // negative-name-word checks (好/坏 tone consistency)

  it('drops good tag with negative name word (混子)', () => {
    const bad = suggestion({ name: '海克斯混子' })
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops good tag with negative name word (翻车)', () => {
    const bad = suggestion({ name: '排位翻车王' })
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('accepts negative name word on bad tag (the word fits the tag)', () => {
    const ok = suggestion({ name: '海克斯混子' })
    const raw = JSON.stringify({ good: [], bad: [ok] })
    const r = parseAndValidate(raw)
    expect(r.bad).toHaveLength(1)
    expect(r.droppedCount).toBe(0)
  })

  it('accepts good tag with neutral 调侃 name (送葬人 OK)', () => {
    const ok = suggestion({ name: '排位送葬人' })
    const raw = JSON.stringify({ good: [ok], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
  })
})
