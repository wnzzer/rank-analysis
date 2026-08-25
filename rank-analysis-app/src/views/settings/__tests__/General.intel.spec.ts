/**
 * General.vue「战术情报」设置区接线测试。
 *
 * 挂载真实组件（与 General.aiProvider.spec.ts 同一约定）：naive-ui 组件真实渲染，
 * useMessage 替换为共享 mock；knowledge 服务以 mock 注入假状态/刷新结果。
 *
 * 覆盖：
 * - 键缺省（undefined）时战术情报默认开启
 * - 开关切换持久化 opgg.enabled 键
 * - 知识库状态展示（远程/内置来源 + 版本 + 更新时间）
 * - 手动刷新调用 forceUpdateKnowledge 并回填状态
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('@renderer/services/knowledge', () => ({
  getKnowledgeStatus: vi.fn(),
  forceUpdateKnowledge: vi.fn()
}))

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

import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { getKnowledgeStatus, forceUpdateKnowledge } from '@renderer/services/knowledge'
import General from '../General.vue'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockStatus = vi.mocked(getKnowledgeStatus)
const mockForce = vi.mocked(forceUpdateKnowledge)

const statusFixture = {
  patch: '26.13',
  updatedAt: '2026-08-16T00:00:00.000Z',
  source: 'remote',
  stale: false
}

/** 定位「战术情报」所在表单项内的 n-switch（页面还有错误上报/备注开关，须按 label 区分） */
function intelSwitch(w: VueWrapper): DOMWrapper<Element> {
  const item = w.findAll('.n-form-item').find(el => el.text().includes('战术情报'))
  if (!item) throw new Error('未找到战术情报表单项')
  return item.find('.n-switch')
}

async function mountGeneral() {
  const w = mount(General, {
    global: { plugins: [naive] }
  })
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockImplementation(async () => undefined)
  mockPut.mockResolvedValue(undefined)
  mockStatus.mockResolvedValue(statusFixture)
  mockForce.mockResolvedValue(null)
})

describe('General.vue 战术情报设置区', () => {
  it('键缺省（undefined）时开关默认开启', async () => {
    const w = await mountGeneral()
    const switchEl = intelSwitch(w)
    expect(switchEl.classes()).toContain('n-switch--active')
  })

  it('键显式 false 时开关为关闭态', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === CONFIG_KEYS.opggEnabled) return false
      return undefined
    })
    const w = await mountGeneral()
    expect(intelSwitch(w).classes()).not.toContain('n-switch--active')
  })

  it('开关切换持久化 opgg.enabled 键', async () => {
    const w = await mountGeneral()
    await intelSwitch(w).trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.opggEnabled, false)
  })

  it('展示远程知识库版本与更新时间', async () => {
    const w = await mountGeneral()
    expect(w.text()).toContain('远程知识库 v26.13')
    expect(w.text()).toContain('更新')
  })

  it('内置来源时展示「内置知识库」', async () => {
    mockStatus.mockResolvedValue({ ...statusFixture, source: 'fallback' })
    const w = await mountGeneral()
    expect(w.text()).toContain('内置知识库 v26.13')
  })

  it('刷新按钮调用 forceUpdateKnowledge 并回填最新状态', async () => {
    mockForce.mockResolvedValue({
      patch: '26.13',
      updatedAt: 'x',
      signalRules: [],
      modeKnowledge: {},
      championNotes: {},
      patchNotes: {},
      schemaVersion: 1
    })
    const w = await mountGeneral()
    const refreshBtn = w.findAll('button').find(b => b.text().includes('刷新知识库'))
    if (!refreshBtn) throw new Error('未找到刷新知识库按钮')
    await refreshBtn.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(mockForce).toHaveBeenCalled()
    expect(messageMock.success).toHaveBeenCalledWith('知识库已更新至 v26.13')
    expect(mockStatus).toHaveBeenCalledTimes(2)
  })

  it('刷新失败（force 返回 null）提示使用内置数据', async () => {
    const w = await mountGeneral()
    const refreshBtn = w.findAll('button').find(b => b.text().includes('刷新知识库'))
    if (!refreshBtn) throw new Error('未找到刷新知识库按钮')
    await refreshBtn.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(messageMock.warning).toHaveBeenCalledWith('知识库更新失败，当前使用内置数据')
  })
})
