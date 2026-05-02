/**
 * AISuggestModal 组件单元测试
 *
 * 验证：
 * - insufficient 状态下显示"近期对局太少"
 * - ok 状态下渲染 good/bad 卡片内容
 * - 采用按钮调用 save_tag_configs 并合并已有标签列表
 * - 重新生成按钮以 forceRefresh=true 再次调用编排器
 *
 * @module components/tags/__tests__/AISuggestModal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))
vi.mock('@renderer/services/ai/tagSuggest', () => ({
  requestTagSuggestions: vi.fn(),
  markAdopted: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { requestTagSuggestions } from '@renderer/services/ai/tagSuggest'
import AISuggestModal from '../AISuggestModal.vue'

/**
 * Naive-UI 在 jsdom 中通过 teleport 渲染 NModal，导致内容被传送到 body 之外，
 * findAll('button') 找不到 slot 内容。
 * 解决方案：按 naive-ui 实际组件名（Modal/Card/Button 等）注册 stub，
 * 让内容直接内联渲染，无需依赖 teleport。
 */
const stubs = {
  Modal: { template: '<div><slot /></div>' },
  Card: { template: '<div><slot /><slot name="header-extra" /></div>' },
  Button: {
    template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  Tag: { template: '<span><slot /></span>' },
  Space: { template: '<div><slot /></div>' },
  Spin: { template: '<div>spinning</div>' },
  Empty: { template: '<div>{{ $attrs.description }}<slot /><slot name="extra" /></div>' },
  Text: { template: '<span><slot /></span>' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AISuggestModal', () => {
  /**
   * 测试：insufficient 状态下应显示"近期对局太少"提示
   */
  it('shows insufficient state when game count < 5', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({ kind: 'insufficient', gameCount: 3 })
    const w = mount(AISuggestModal, {
      props: { show: true },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('近期对局太少')
  })

  /**
   * 测试：ok 状态下应渲染 good/bad 标签名称
   */
  it('shows ok results with good/bad cards', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({
      kind: 'ok',
      puuid: 'me',
      result: {
        good: [
          {
            id: 'g1',
            name: '中路雕将',
            desc: 'ok',
            good: true,
            enabled: true,
            condition: { type: 'currentQueue', ids: [420] },
            isDefault: false
          }
        ],
        bad: [
          {
            id: 'b1',
            name: '兵线漂泊',
            desc: 'bad',
            good: false,
            enabled: true,
            condition: { type: 'currentQueue', ids: [420] },
            isDefault: false
          }
        ],
        droppedCount: 0,
        generatedAt: '2026-05-02T00:00:00Z'
      }
    } as any)
    const w = mount(AISuggestModal, { props: { show: true }, global: { stubs } })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('中路雕将')
    expect(w.text()).toContain('兵线漂泊')
  })

  /**
   * 测试：点击"采用"按钮应调用 save_tag_configs，并将建议追加到已有列表
   */
  it('adopt calls save_tag_configs with merged list', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({
      kind: 'ok',
      puuid: 'me',
      result: {
        good: [
          {
            id: 'g1',
            name: '中路雕将',
            desc: 'd',
            good: true,
            enabled: true,
            condition: { type: 'currentQueue', ids: [420] },
            isDefault: false
          }
        ],
        bad: [],
        droppedCount: 0,
        generatedAt: '2026-05-02'
      }
    } as any)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_all_tag_configs') return [{ id: 'existing', name: 'X' }]
      if (cmd === 'save_tag_configs') return undefined
      throw new Error('unexpected: ' + cmd)
    })
    const w = mount(AISuggestModal, { props: { show: true }, global: { stubs } })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    const adoptBtn = w.findAll('button').find(b => b.text().trim() === '采用')!
    await adoptBtn.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'save_tag_configs',
      expect.objectContaining({
        configs: expect.arrayContaining([
          expect.objectContaining({ id: 'existing' }),
          expect.objectContaining({ id: 'g1' })
        ])
      })
    )
  })

  /**
   * 测试：点击"重新生成"按钮应以 forceRefresh=true 再次调用编排器
   */
  it('forceRefresh calls requestTagSuggestions twice', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({
      kind: 'ok',
      puuid: 'me',
      result: { good: [], bad: [], droppedCount: 0, generatedAt: 'x' }
    })
    const w = mount(AISuggestModal, { props: { show: true }, global: { stubs } })
    await new Promise(r => setTimeout(r, 0))
    expect(vi.mocked(requestTagSuggestions)).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()
    vi.mocked(requestTagSuggestions).mockResolvedValue({
      kind: 'ok',
      puuid: 'me',
      result: { good: [], bad: [], droppedCount: 0, generatedAt: 'x' }
    })

    const refreshBtn = w.findAll('button').find(b => b.text().includes('重新生成'))
    await refreshBtn?.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    // ok result with empty good/bad renders two "重新生成" buttons (header-extra + empty-state);
    // asserting forceRefresh=true was passed is the meaningful invariant here
    expect(vi.mocked(requestTagSuggestions)).toHaveBeenCalledWith(true)
    expect(vi.mocked(requestTagSuggestions).mock.calls[0][0]).toBe(true)
  })
})
