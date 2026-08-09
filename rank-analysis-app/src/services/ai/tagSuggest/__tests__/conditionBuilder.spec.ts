import { describe, it, expect } from 'vitest'
import { buildCondition } from '../conditionBuilder'
import type { Candidate } from '../types'

describe('buildCondition — history + stat + count', () => {
  it('produces a history condition with queue + stat filter + count refresh', () => {
    const c: Candidate = {
      id: 'g1',
      metric: 'kda',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 4.5,
      countMin: 5,
      evidence: '',
      vibe: []
    }
    const cond = buildCondition(c)
    expect(cond.type).toBe('history')
    if (cond.type !== 'history') return
    expect(cond.filters).toHaveLength(2)
    expect(cond.filters[0]).toEqual({ type: 'queue', ids: [420, 440] })
    expect(cond.filters[1]).toEqual({
      type: 'stat',
      metric: 'kda',
      op: '>=',
      value: 4.5
    })
    expect(cond.refresh).toEqual({ type: 'count', op: '>=', value: 5 })
  })

  it('strips queue filter when queueIds is empty (all modes)', () => {
    const c: Candidate = {
      id: 'g2',
      metric: 'damage',
      queueIds: [],
      direction: '>=',
      threshold: 30000,
      countMin: 5,
      evidence: '',
      vibe: []
    }
    const cond = buildCondition(c)
    expect(cond.type).toBe('history')
    if (cond.type !== 'history') return
    // No queue filter → only the stat filter remains
    expect(cond.filters).toHaveLength(1)
    expect(cond.filters[0].type).toBe('stat')
  })

  it('passes through the direction operator unchanged for "<="', () => {
    const c: Candidate = {
      id: 'b1',
      metric: 'deaths',
      queueIds: [420, 440],
      direction: '<=',
      threshold: 3,
      countMin: 5,
      evidence: '',
      vibe: []
    }
    const cond = buildCondition(c)
    if (cond.type !== 'history') throw new Error('expected history')
    expect(cond.filters[1]).toMatchObject({ type: 'stat', op: '<=' })
  })
})

describe('buildCondition — streak variant', () => {
  it('produces a streak refresh and no stat filter', () => {
    const c: Candidate = {
      id: 'b2',
      metric: 'streak',
      queueIds: [420, 440],
      direction: 'loss',
      threshold: 0,
      countMin: 3,
      evidence: '',
      vibe: []
    }
    const cond = buildCondition(c)
    expect(cond.type).toBe('history')
    if (cond.type !== 'history') return
    expect(cond.filters).toEqual([{ type: 'queue', ids: [420, 440] }])
    expect(cond.refresh).toEqual({ type: 'streak', min: 3, kind: 'loss' })
  })

  it('streak with kind=win', () => {
    const c: Candidate = {
      id: 'g3',
      metric: 'streak',
      queueIds: [450],
      direction: 'win',
      threshold: 0,
      countMin: 5,
      evidence: '',
      vibe: []
    }
    const cond = buildCondition(c)
    if (cond.type !== 'history') throw new Error('expected history')
    expect(cond.refresh).toEqual({ type: 'streak', min: 5, kind: 'win' })
  })

  it('streak with empty queueIds → no queue filter', () => {
    const c: Candidate = {
      id: 'g4',
      metric: 'streak',
      queueIds: [],
      direction: 'loss',
      threshold: 0,
      countMin: 3,
      evidence: '',
      vibe: []
    }
    const cond = buildCondition(c)
    if (cond.type !== 'history') throw new Error('expected history')
    expect(cond.filters).toEqual([])
  })
})
