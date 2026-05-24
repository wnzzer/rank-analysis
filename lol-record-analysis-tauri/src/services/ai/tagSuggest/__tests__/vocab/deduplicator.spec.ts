import { describe, it, expect, beforeEach } from 'vitest'
import {
  readRecentNames,
  writeRecentNames,
  clearRecentNames,
  DEDUP_KEY_PREFIX,
  MAX_BATCHES
} from '../../vocab/deduplicator'

beforeEach(() => {
  sessionStorage.clear()
})

describe('writeRecentNames + readRecentNames', () => {
  it('round-trips a single batch', () => {
    writeRecentNames('p1', ['雕花匠', '收割者', '夜枭'])
    expect(readRecentNames('p1')).toEqual(['雕花匠', '收割者', '夜枭'])
  })

  it('appends batches across writes and merges them', () => {
    writeRecentNames('p1', ['A1', 'A2'])
    writeRecentNames('p1', ['B1', 'B2'])
    writeRecentNames('p1', ['C1', 'C2'])
    const read = readRecentNames('p1')
    expect(read).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
  })

  it('keeps only the most recent MAX_BATCHES batches (oldest dropped)', () => {
    expect(MAX_BATCHES).toBe(3)
    writeRecentNames('p1', ['A1'])
    writeRecentNames('p1', ['B1'])
    writeRecentNames('p1', ['C1'])
    writeRecentNames('p1', ['D1']) // pushes A1 out
    const read = readRecentNames('p1')
    expect(read).toEqual(['B1', 'C1', 'D1'])
    expect(read).not.toContain('A1')
  })

  it('isolates puuids — writing p1 does not affect p2', () => {
    writeRecentNames('p1', ['X'])
    writeRecentNames('p2', ['Y'])
    expect(readRecentNames('p1')).toEqual(['X'])
    expect(readRecentNames('p2')).toEqual(['Y'])
  })

  it('handles empty write gracefully (no-op)', () => {
    writeRecentNames('p1', [])
    expect(readRecentNames('p1')).toEqual([])
  })

  it('readRecentNames on unknown puuid → []', () => {
    expect(readRecentNames('ghost')).toEqual([])
  })

  it('survives corrupt sessionStorage value (returns [])', () => {
    sessionStorage.setItem(`${DEDUP_KEY_PREFIX}p1`, 'not json')
    expect(readRecentNames('p1')).toEqual([])
  })
})

describe('clearRecentNames', () => {
  it('empties the storage for that puuid', () => {
    writeRecentNames('p1', ['A', 'B'])
    expect(readRecentNames('p1')).toHaveLength(2)
    clearRecentNames('p1')
    expect(readRecentNames('p1')).toEqual([])
  })

  it('does not affect other puuids', () => {
    writeRecentNames('p1', ['A'])
    writeRecentNames('p2', ['B'])
    clearRecentNames('p1')
    expect(readRecentNames('p2')).toEqual(['B'])
  })
})
