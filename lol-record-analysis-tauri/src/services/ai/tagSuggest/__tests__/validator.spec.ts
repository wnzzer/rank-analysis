import { describe, it, expect } from 'vitest'
import { parseAndValidate } from '../validator'

describe('parseAndValidate', () => {
  function suggestion(overrides: Partial<{ name: string; desc: string }> = {}) {
    return {
      name: '中路雕将',
      desc: '中路场均 KDA 高',
      condition: {
        type: 'history',
        filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
        refresh: { type: 'count', op: '>=', value: 5 },
      },
      ...overrides,
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
      bad: [suggestion()],
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
    expect(r.good[0].id).toMatch(/[a-f0-9-]+/)
    expect(r.good[0].isDefault).toBe(false)
    expect(r.good[0].enabled).toBe(true)
  })
})
