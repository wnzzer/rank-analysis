import { describe, it, expect } from 'vitest'
import { mergeNotesMaps, TOMBSTONE_TTL_MS } from '../mergePlayerNotes'
import type { PlayerNotesMap } from '@renderer/types/domain/playerNote'

function note(updatedAt: number, text = 'x'): PlayerNotesMap[string] {
  return { note: text, label: 'normal', gameName: 'A', tagLine: '1', updatedAt }
}

describe('mergeNotesMaps', () => {
  it('新 puuid 直接加入,计入 added', () => {
    const { merged, stats } = mergeNotesMaps({}, { p1: note(100) })
    expect(merged.p1.updatedAt).toBe(100)
    expect(stats).toEqual({ added: 1, replaced: 0, kept: 0, invalid: 0, expired: 0 })
  })

  it('同 puuid 时间戳新者赢', () => {
    const { merged, stats } = mergeNotesMaps({ p1: note(100, 'old') }, { p1: note(200, 'new') })
    expect(merged.p1.note).toBe('new')
    expect(stats.replaced).toBe(1)
  })

  it('同 puuid 传入更旧则保留本地,计入 kept', () => {
    const { merged, stats } = mergeNotesMaps({ p1: note(200, 'local') }, { p1: note(100, 'stale') })
    expect(merged.p1.note).toBe('local')
    expect(stats.kept).toBe(1)
  })

  it('时间戳相等保留本地(避免无谓覆盖)', () => {
    const { stats } = mergeNotesMaps({ p1: note(100, 'local') }, { p1: note(100, 'remote') })
    expect(stats.kept).toBe(1)
  })

  it('非法条目跳过并计入 invalid,不污染结果', () => {
    const bad = {
      p2: null,
      p3: 'str',
      p4: { note: 'no-ts', label: 'normal' }
    } as unknown as PlayerNotesMap
    const { merged, stats } = mergeNotesMaps({}, bad)
    expect(Object.keys(merged)).toHaveLength(0)
    expect(stats.invalid).toBe(3)
  })

  it('NaN updatedAt 计入 invalid(非有限时间戳一旦并入将永远无法被替换)', () => {
    const { merged, stats } = mergeNotesMaps({}, { p1: note(NaN) })
    expect(Object.keys(merged)).toHaveLength(0)
    expect(stats.invalid).toBe(1)
  })

  it('toString 等原型链键的合法 note 正常 added', () => {
    const { merged, stats } = mergeNotesMaps({}, { toString: note(100, 'proto-key') })
    expect(stats).toEqual({ added: 1, replaced: 0, kept: 0, invalid: 0, expired: 0 })
    expect(merged.toString).toEqual(note(100, 'proto-key'))
  })

  it('__proto__ 键计入 invalid 且不污染 Object.prototype', () => {
    const incoming = JSON.parse(`{"__proto__": ${JSON.stringify(note(100))}}`) as PlayerNotesMap
    const { merged, stats } = mergeNotesMaps({}, incoming)
    expect(stats.invalid).toBe(1)
    expect(Object.keys(merged)).toHaveLength(0)
    expect(({} as Record<string, unknown>).note).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('note')
  })

  it('混合合法+非法条目,invalid 不影响 added/replaced 计数', () => {
    const incoming = {
      p1: note(200, 'newer'),
      p2: note(100, 'fresh'),
      p3: null,
      p4: note(NaN)
    } as unknown as PlayerNotesMap
    const { merged, stats } = mergeNotesMaps({ p1: note(100, 'old') }, incoming)
    expect(stats).toEqual({ added: 1, replaced: 1, kept: 0, invalid: 2, expired: 0 })
    expect(merged.p1.note).toBe('newer')
    expect(merged.p2.note).toBe('fresh')
  })

  it('不修改入参(纯函数)', () => {
    const base = { p1: note(100) }
    mergeNotesMaps(base, { p2: note(50) })
    expect(Object.keys(base)).toEqual(['p1'])
  })

  describe('墓碑 TTL(过期删除标记不随合并复活)', () => {
    const NOW = 1_800_000_000_000

    function tombstone(updatedAt: number): PlayerNotesMap[string] {
      return { note: '', label: 'normal', gameName: 'A', tagLine: '1', updatedAt, deleted: true }
    }

    it('过期墓碑(超过 TTL)被跳过,计入 expired,不并入结果', () => {
      const dead = tombstone(NOW - TOMBSTONE_TTL_MS - 1)
      const { merged, stats } = mergeNotesMaps({}, { p1: dead }, NOW)
      expect(merged.p1).toBeUndefined()
      expect(stats.expired).toBe(1)
      expect(stats.added).toBe(0)
    })

    it('未过期墓碑正常参与新者赢(删除传播不受影响)', () => {
      const fresh = tombstone(NOW - 1000)
      const { merged, stats } = mergeNotesMaps(
        { p1: note(NOW - 2000, 'alive') },
        { p1: fresh },
        NOW
      )
      expect(merged.p1.deleted).toBe(true)
      expect(stats.replaced).toBe(1)
      expect(stats.expired).toBe(0)
    })

    it('活备注不受 TTL 影响(再老也照常合并)', () => {
      const ancient = note(NOW - TOMBSTONE_TTL_MS * 10, 'old-but-alive')
      const { merged, stats } = mergeNotesMaps({}, { p1: ancient }, NOW)
      expect(merged.p1.note).toBe('old-but-alive')
      expect(stats.added).toBe(1)
      expect(stats.expired).toBe(0)
    })

    it('过期墓碑不能压过本地条目(跳过即保持本地)', () => {
      const dead = tombstone(NOW - TOMBSTONE_TTL_MS - 1)
      const { merged, stats } = mergeNotesMaps({ p1: note(1, 'local') }, { p1: dead }, NOW)
      expect(merged.p1.note).toBe('local')
      expect(merged.p1.deleted).toBeUndefined()
      expect(stats.expired).toBe(1)
    })
  })
})
