/**
 * buildNoteBrief 单元测试 + extractPlayerInsight 的 userNote 注入测试
 * @module services/ai/shared/noteBrief
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock config IPC，避免触达 Tauri runtime（setNote 会落盘）
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))

// Mock Tauri 事件（playerNotes store 落盘后跨窗口广播用）
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

import { buildNoteBrief } from '../noteBrief'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'
import { extractPlayerInsight } from '../../player-insight'

describe('buildNoteBrief', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('无备注返回 undefined', () => {
    expect(buildNoteBrief('nobody')).toBeUndefined()
  })

  it('有备注返回 [色档] 文本，超 50 字截断', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p1', {
      note: 'x'.repeat(80),
      label: 'blacklist',
      gameName: 'A',
      tagLine: '1'
    })
    const brief = buildNoteBrief('p1')
    expect(brief).toContain('[拉黑]')
    expect(brief!.length).toBeLessThanOrEqual('[拉黑] '.length + 50)
  })

  it('只标色档不写字时仅返回 [色档]', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p2', { note: '', label: 'friendly', gameName: 'B', tagLine: '2' })
    expect(buildNoteBrief('p2')).toBe('[友好]')
  })

  it('备注为纯空白时也仅返回 [色档]', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('p3', { note: '   ', label: 'careful', gameName: 'C', tagLine: '3' })
    expect(buildNoteBrief('p3')).toBe('[小心]')
  })
})

describe('extractPlayerInsight 的 noteBrief 注入', () => {
  /** 最小玩家对象：extractPlayerInsight 对缺失字段均有兜底 */
  const minimalPlayer = { summoner: { gameName: '测试玩家' } }

  it('不传 noteBrief 时返回对象无 userNote 字段（开关关闭场景）', () => {
    const out = extractPlayerInsight(minimalPlayer, { detailed: false })
    expect('userNote' in out).toBe(false)
  })

  it('传 noteBrief 时返回对象带 userNote', () => {
    const out = extractPlayerInsight(minimalPlayer, {
      detailed: false,
      noteBrief: '[拉黑] 演员'
    })
    expect(out.userNote).toBe('[拉黑] 演员')
  })
})
