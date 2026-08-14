/**
 * General.vue「AI 服务商」设置区（D-P4 平台化）接线测试。
 *
 * 挂载真实组件（与 Automation.tierSelect.spec.ts 同一约定）：naive-ui 的
 * <n-select> 用受控原生 <select> stub 承接（jsdom 里 VBinder 下拉难驱动），
 * 其余 naive-ui 组件保持真实渲染；useMessage 替换为共享 mock。
 *
 * 覆盖：
 * - 缺省 dashscope：显示「自定义 AI Key」、隐藏「服务端地址」与 OpenAI「API Key」
 * - 切 openai：一次性持久化 provider/baseUrl/model/apiKey 四键，地址与 Key 输入框出现
 * - 切 ollama：两个密钥输入框都消失，地址占位提示本地默认端点
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
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
import General from '../General.vue'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)

const stubs = {
  Select: {
    props: ['value', 'options'],
    emits: ['update:value'],
    template:
      '<select :value="value" @change="$emit(\'update:value\', $event.target.value)">' +
      '<option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>' +
      '</select>'
  }
}

/** 定位服务商下拉：唯一含 ollama 选项的 <select> */
function findProviderSelect(w: { findAll: (s: string) => { html(): string }[] }): {
  element: HTMLSelectElement
  setValue(v: string): Promise<void>
} {
  const select = w.findAll('select').find(s => s.html().includes('value="ollama"')) as unknown as {
    element: HTMLSelectElement
    setValue(v: string): Promise<void>
  }
  if (!select) throw new Error('未找到 AI 服务商 <select>（含 ollama 选项）')
  return select
}

beforeEach(() => {
  vi.clearAllMocks()
  // 键感知的配置读取：只给 dashscope key，服务商缺省走 dashscope 归一
  mockGet.mockImplementation(async (key: string) => {
    if (key === CONFIG_KEYS.dashscopeApiKey) return 'sk-dash'
    return undefined
  })
  mockPut.mockResolvedValue(undefined)
})

async function mountGeneral() {
  const w = mount(General, {
    global: { plugins: [naive], stubs }
  })
  await new Promise(r => setTimeout(r, 0))
  await w.vm.$nextTick()
  return w
}

describe('General.vue AI 服务商设置区', () => {
  it('缺省 dashscope：显示自定义 AI Key，无服务端地址与 OpenAI Key 输入框', async () => {
    const w = await mountGeneral()

    expect(findProviderSelect(w).element?.value).toBe('dashscope')
    // dashscope 专属「自定义 AI Key」密码框存在
    expect(w.findAll('input[type="password"]')).toHaveLength(1)
    // 服务端地址（仅非 dashscope）不渲染
    expect(w.find('input[placeholder*="http://127.0.0.1:11434"]').exists()).toBe(false)
  })

  it('切到 openai：四键一并持久化，地址与 Key 输入框出现', async () => {
    const w = await mountGeneral()

    const providerSelect = findProviderSelect(w)
    await providerSelect.setValue('openai')
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.aiProvider, 'openai')
    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.aiBaseUrl, '')
    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.aiModel, '')
    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.aiApiKey, '')
    // dashscope 专属 Key 隐藏、openai 专属 Key 显示 → 密码框 1 个
    expect(w.findAll('input[type="password"]')).toHaveLength(1)
    // 服务端地址出现且占位提示 DeepSeek 默认端点
    expect(w.find('input[placeholder*="https://api.deepseek.com/v1"]').exists()).toBe(true)
  })

  it('切到 ollama：密钥输入框消失，地址占位为本地默认端点', async () => {
    const w = await mountGeneral()

    await findProviderSelect(w).setValue('ollama')
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.aiProvider, 'ollama')
    // dashscope 与 openai 的 Key 输入框都隐藏 → 密码框 0 个
    expect(w.findAll('input[type="password"]')).toHaveLength(0)
    expect(w.find('input[placeholder*="http://127.0.0.1:11434"]').exists()).toBe(true)
  })

  it('地址输入 blur 时持久化 ai.baseUrl', async () => {
    const w = await mountGeneral()

    await findProviderSelect(w).setValue('ollama')
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    const addr = w.find('input[placeholder*="http://127.0.0.1:11434"]')
    await addr.setValue('http://192.168.1.5:11434')
    await addr.trigger('blur')
    await new Promise(r => setTimeout(r, 0))

    expect(mockPut).toHaveBeenCalledWith(CONFIG_KEYS.aiBaseUrl, 'http://192.168.1.5:11434')
  })
})
