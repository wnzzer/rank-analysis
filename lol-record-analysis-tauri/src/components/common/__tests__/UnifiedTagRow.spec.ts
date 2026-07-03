/**
 * UnifiedTagRow 组件单元测试
 *
 * 验证：
 * - 系统标签 chips 渲染（good/bad 均展示 tagName）
 * - 有备注时渲染备注 chip（data-test="note-chip"）
 * - solidifyTag 一键固化：good→friendly / bad→careful、文本追加、色档保留
 * - tagDesc 为空时固化文本不带「：」
 *
 * @module components/common/__tests__/UnifiedTagRow
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// Mock config IPC，避免触达 Tauri runtime（照抄 pinia/__tests__/playerNotes.spec.ts）
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))

// Mock Tauri 事件（跨窗口同步用），jsdom 下无 Tauri runtime
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

// jsdom 下没有 n-message-provider，替换 useMessage 为共享 mock（其余 naive-ui 导出保持原样）
const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

import UnifiedTagRow from '../UnifiedTagRow.vue'
import { usePlayerNotesStore } from '../../../pinia/playerNotes'
import type { RankTag } from '@renderer/types/domain/analysis'

/**
 * Naive-UI 的 popover/tooltip 在 jsdom 中经 teleport 渲染，slot 内容会脱离
 * wrapper。按组件名注册 stub 让内容内联渲染（同 AISuggestModal.spec.ts 方案）。
 */
const stubs = {
  Popover: { template: '<div><slot name="trigger" /><slot /></div>' },
  Tooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
  Tag: { template: '<span><slot /></span>' },
  Button: { template: '<button @click="$emit(\'click\')"><slot /></button>' }
}

const tags: RankTag[] = [
  { tagName: '炸鱼嫌疑', tagDesc: '仅供参考', good: false },
  { tagName: '专精', tagDesc: '', good: true }
]

/** 便捷挂载：默认无备注玩家 */
function mountRow(props: Partial<InstanceType<typeof UnifiedTagRow>['$props']> = {}) {
  return mount(UnifiedTagRow, {
    props: {
      tags,
      puuid: 'puuid-1',
      gameName: 'Hide on bush',
      tagLine: 'KR1',
      ...props
    },
    global: { stubs }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('UnifiedTagRow', () => {
  it('渲染系统标签 chips（两个 tagName 都在文本中）', () => {
    const w = mountRow()

    expect(w.text()).toContain('炸鱼嫌疑')
    expect(w.text()).toContain('专精')
    // 无备注时不渲染备注 chip
    expect(w.find('[data-test="note-chip"]').exists()).toBe(false)
  })

  it('有备注时渲染 note-chip', async () => {
    const store = usePlayerNotesStore()
    await store.setNote('puuid-1', {
      note: '别抢我蓝',
      label: 'friendly',
      gameName: 'Hide on bush',
      tagLine: 'KR1'
    })

    const w = mountRow()

    const chip = w.find('[data-test="note-chip"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('别抢我蓝')
  })

  it('solidifyTag 固化：good→friendly、note 含 tagName；再固化第二个色档保持、note 含两行', async () => {
    const store = usePlayerNotesStore()
    const w = mountRow()

    // 固化 good 标签（专精）：无备注 → 色档 friendly
    await w.vm.solidifyTag(tags[1])
    expect(store.getNote('puuid-1')?.label).toBe('friendly')
    expect(store.getNote('puuid-1')?.note).toContain('专精')
    expect(messageMock.success).toHaveBeenCalled()

    // 再固化 bad 标签（炸鱼嫌疑）：文本追加两行，色档保留原值 friendly
    await w.vm.solidifyTag(tags[0])
    const saved = store.getNote('puuid-1')
    expect(saved?.label).toBe('friendly')
    expect(saved?.note).toBe('专精\n炸鱼嫌疑：仅供参考')
  })

  it('bad 标签固化到无备注玩家时色档为 careful', async () => {
    const store = usePlayerNotesStore()
    const w = mountRow()

    await w.vm.solidifyTag(tags[0])

    expect(store.getNote('puuid-1')?.label).toBe('careful')
    expect(store.getNote('puuid-1')?.note).toBe('炸鱼嫌疑：仅供参考')
  })

  it('tagDesc 为空时固化文本不带「：」', async () => {
    const store = usePlayerNotesStore()
    const w = mountRow()

    await w.vm.solidifyTag(tags[1])

    expect(store.getNote('puuid-1')?.note).toBe('专精')
  })
})
