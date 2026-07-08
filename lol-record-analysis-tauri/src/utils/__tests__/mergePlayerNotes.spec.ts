import { describe, it, expect } from 'vitest'
import { mergeNotesMaps } from '../mergePlayerNotes'
import type { PlayerNotesMap } from '@renderer/types/domain/playerNote'

function note(updatedAt: number, text = 'x'): PlayerNotesMap[string] {
  return { note: text, label: 'normal', gameName: 'A', tagLine: '1', updatedAt }
}

describe('mergeNotesMaps', () => {
  it('新 puuid 直接加入,计入 added', () => {
    const { merged, stats } = mergeNotesMaps({}, { p1: note(100) })
    expect(merged.p1.updatedAt).toBe(100)
    expect(stats).toEqual({ added: 1, replaced: 0, kept: 0, invalid: 0 })
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
    expect(stats).toEqual({ added: 1, replaced: 0, kept: 0, invalid: 0 })
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
    expect(stats).toEqual({ added: 1, replaced: 1, kept: 0, invalid: 2 })
    expect(merged.p1.note).toBe('newer')
    expect(merged.p2.note).toBe('fresh')
  })

  it('不修改入参(纯函数)', () => {
    const base = { p1: note(100) }
    mergeNotesMaps(base, { p2: note(50) })
    expect(Object.keys(base)).toEqual(['p1'])
  })
})
