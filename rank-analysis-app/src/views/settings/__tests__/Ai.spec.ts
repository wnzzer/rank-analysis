/**
 * 设置页「AI 模型」：三种服务的显示、未改项显示来源、改动与恢复、
 * 切换服务后另一边的填写仍在、拉不到模型列表时的退化、测试连接的结果。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import naive, { NMessageProvider } from 'naive-ui'
import { defineComponent, h } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import Ai from '../Ai.vue'

const store = vi.hoisted(() => ({ config: new Map<string, unknown>() }))

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: async (k: string) => store.config.get(k),
  putConfigByIpc: async (k: string, v: unknown) => void store.config.set(k, v)
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const mockInvoke = vi.mocked(invoke)

/** 各命令的返回，测试里按需改 */
const ipc = {
  models: ['qwen-plus', 'qwen4-max'] as string[] | Error,
  test: { ok: true, ms: 1200, error: null } as { ok: boolean; ms: number; error: string | null },
  region: { country: 'US', allowed: true, error: null }
}

async function mountAi(): Promise<VueWrapper> {
  const w = mount(defineComponent({ render: () => h(NMessageProvider, () => h(Ai)) }), {
    global: { plugins: [naive] },
    attachTo: document.body
  })
  await flushPromises()
  // 「按功能指定模型」默认收起，收起时内容不渲染：测试里先展开
  const header = w.find('.n-collapse-item__header-main')
  if (header.exists()) {
    await header.trigger('click')
    await flushPromises()
  }
  return w
}

const input = (w: VueWrapper, test: string) => w.get(`[data-test="${test}"] input`)

/** 在输入框里填值并失焦（失焦才保存） */
async function fill(w: VueWrapper, selector: string, value: string): Promise<void> {
  const el = w.get(selector)
  await el.setValue(value)
  await el.trigger('blur')
  await flushPromises()
}

beforeEach(() => {
  store.config.clear()
  ipc.models = ['qwen-plus', 'qwen4-max']
  ipc.test = { ok: true, ms: 1200, error: null }
  ipc.region = { country: 'US', allowed: true, error: null }
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'get_ai_config':
        return {
          schemaVersion: 1,
          models: { default: 'remote-default', labelRebuttal: 'remote-reb' }
        }
      case 'check_claude_region':
        return ipc.region
      case 'list_ai_models':
        if (ipc.models instanceof Error) throw ipc.models
        return ipc.models
      case 'test_ai_endpoint':
        return ipc.test
      default:
        return undefined
    }
  })
})

describe('内置服务（默认）', () => {
  it('地址只读显示阿里云地址，密钥提示用内置的，默认模型提示内置推荐', async () => {
    const w = await mountAi()
    const url = input(w, 'ai-base-url').element as HTMLInputElement
    expect(url.value).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(url.readOnly).toBe(true)
    expect(input(w, 'ai-api-key').attributes('placeholder')).toBe('留空使用内置密钥')
    expect(input(w, 'ai-default-model').attributes('placeholder')).toBe('内置推荐：remote-default')
  })

  it('各功能没改过时显示实际会用的模型与来源', async () => {
    const w = await mountAi()
    expect(w.get('[data-test="scene-inGame"] input').attributes('placeholder')).toBe(
      '内置推荐：remote-default'
    )
    expect(w.get('[data-test="scene-labelRebuttal"] input').attributes('placeholder')).toBe(
      '内置推荐：remote-reb'
    )
    // 标签建议：远程没有它的条目，走远程 default
    expect(w.get('[data-test="scene-tagSuggest"] input').attributes('placeholder')).toBe(
      '内置推荐：remote-default'
    )
    expect(w.find('[data-test="scene-reset"]').exists()).toBe(false)
  })

  it('改默认模型：存进 aiModels.dashscope，各功能改为跟随默认', async () => {
    const w = await mountAi()
    await fill(w, '[data-test="ai-default-model"] input', 'my-model')
    expect(store.config.get('aiModels')).toEqual({ dashscope: { default: 'my-model' }, custom: {} })
    expect(w.get('[data-test="scene-inGame"] input').attributes('placeholder')).toBe(
      '跟随默认：my-model'
    )
  })

  it('给功能单独指定：出现「恢复」，点了回到跟随', async () => {
    const w = await mountAi()
    await fill(w, '[data-test="scene-inGame"] input', 'my-ingame')
    expect(store.config.get('aiModels')).toMatchObject({ dashscope: { inGame: 'my-ingame' } })

    await w.get('[data-test="scene-inGame"] [data-test="scene-reset"]').trigger('click')
    await flushPromises()
    expect(store.config.get('aiModels')).toEqual({ dashscope: {}, custom: {} })
    expect(w.find('[data-test="scene-reset"]').exists()).toBe(false)
  })

  it('填自己的阿里云密钥：存进 dashscopeApiKey', async () => {
    const w = await mountAi()
    await fill(w, '[data-test="ai-api-key"] input', ' sk-mine ')
    expect(store.config.get('dashscopeApiKey')).toBe('sk-mine')
  })

  it('测试连接：用内置推荐的模型，显示耗时', async () => {
    const w = await mountAi()
    await w.get('[data-test="ai-test"]').trigger('click')
    await flushPromises()
    expect(mockInvoke).toHaveBeenCalledWith('test_ai_endpoint', {
      baseUrl: undefined,
      apiKey: undefined,
      model: 'remote-default'
    })
    expect(w.get('[data-test="ai-test-result"]').text()).toBe('可用 · 1.2 秒')
  })

  it('测试失败：显示服务商的错误', async () => {
    ipc.test = { ok: false, ms: 300, error: 'Incorrect API key provided' }
    const w = await mountAi()
    await w.get('[data-test="ai-test"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="ai-test-result"]').text()).toBe('Incorrect API key provided')
  })
})

describe('自定义接入点', () => {
  beforeEach(() => void store.config.set('aiProvider', 'custom'))

  it('地址可填，默认模型没填时各功能显示「还没填」，且不显示内置推荐', async () => {
    const w = await mountAi()
    const url = input(w, 'ai-base-url').element as HTMLInputElement
    expect(url.readOnly).toBe(false)
    expect(url.value).toBe('')
    expect(input(w, 'ai-default-model').attributes('placeholder')).toBe('选择或输入模型名')
    expect(w.get('[data-test="scene-labelRebuttal"] input').attributes('placeholder')).toBe(
      '跟随默认（还没填默认模型）'
    )
    // 没填地址：不去拉模型列表，也不能测试
    expect(mockInvoke).not.toHaveBeenCalledWith('list_ai_models', expect.anything())
    expect(w.get('[data-test="ai-test"]').attributes('disabled')).toBeDefined()
  })

  it('填地址、密钥、默认模型：各存各的键', async () => {
    const w = await mountAi()
    await fill(w, '[data-test="ai-base-url"] input', 'https://api.example.com/v1/chat/completions')
    await fill(w, '[data-test="ai-api-key"] input', 'sk-custom')
    await fill(w, '[data-test="ai-default-model"] input', 'gpt-x')
    // 误粘的完整端点被截到 /v1
    expect(store.config.get('aiCustomBaseUrl')).toBe('https://api.example.com/v1')
    expect(store.config.get('aiCustomApiKey')).toBe('sk-custom')
    expect(store.config.get('aiModels')).toEqual({ dashscope: {}, custom: { default: 'gpt-x' } })
    expect(store.config.get('dashscopeApiKey')).toBeUndefined()
    expect(w.get('[data-test="scene-inGame"] input').attributes('placeholder')).toBe(
      '跟随默认：gpt-x'
    )
  })

  it('测试连接：带用户填的地址、密钥、模型', async () => {
    store.config.set('aiCustomBaseUrl', 'https://api.example.com/v1')
    store.config.set('aiCustomApiKey', 'sk-custom')
    store.config.set('aiModels', { custom: { default: 'gpt-x' } })
    const w = await mountAi()
    await w.get('[data-test="ai-test"]').trigger('click')
    await flushPromises()
    expect(mockInvoke).toHaveBeenCalledWith('test_ai_endpoint', {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-custom',
      model: 'gpt-x'
    })
  })

  it('拉不到模型列表：提示手动填写', async () => {
    store.config.set('aiCustomBaseUrl', 'https://api.example.com/v1')
    ipc.models = new Error('404')
    const w = await mountAi()
    expect(w.get('[data-test="ai-list-unavailable"]').text()).toContain('请手动填写模型名')
  })

  it('拉到了模型列表：不显示该提示', async () => {
    store.config.set('aiCustomBaseUrl', 'https://api.example.com/v1')
    const w = await mountAi()
    expect(w.find('[data-test="ai-list-unavailable"]').exists()).toBe(false)
  })
})

describe('切换服务', () => {
  it('两边的填写互不影响，切回去还在', async () => {
    store.config.set('aiModels', {
      dashscope: { default: 'ds-mine' },
      custom: { default: 'gpt-x' }
    })
    store.config.set('aiCustomBaseUrl', 'https://api.example.com/v1')
    const w = await mountAi()
    expect((input(w, 'ai-default-model').element as HTMLInputElement).value).toBe('ds-mine')

    await w.get('.card--custom').trigger('click')
    await flushPromises()
    expect(store.config.get('aiProvider')).toBe('custom')
    expect((input(w, 'ai-default-model').element as HTMLInputElement).value).toBe('gpt-x')
    expect((input(w, 'ai-base-url').element as HTMLInputElement).value).toBe(
      'https://api.example.com/v1'
    )

    await w.get('.card--ds').trigger('click')
    await flushPromises()
    expect((input(w, 'ai-default-model').element as HTMLInputElement).value).toBe('ds-mine')
    expect(store.config.get('aiModels')).toEqual({
      dashscope: { default: 'ds-mine' },
      custom: { default: 'gpt-x' }
    })
  })

  it('选了 Claude：不显示接入点与各功能模型，只留它自己的密钥', async () => {
    store.config.set('aiProvider', 'claude')
    const w = await mountAi()
    expect(w.find('[data-test="ai-base-url"]').exists()).toBe(false)
    expect(w.find('[data-test="scene-inGame"]').exists()).toBe(false)
    expect(w.text()).toContain('Anthropic API Key')
  })
})

describe('其他开关', () => {
  it('携带玩家备注、使用对局时间线：默认开，改动写回各自的键', async () => {
    const w = await mountAi()
    const notes = w.get('[data-test="ai-use-notes"]')
    const timeline = w.get('[data-test="ai-use-timeline"]')
    expect(notes.classes()).toContain('n-switch--active')
    expect(timeline.classes()).toContain('n-switch--active')

    await notes.trigger('click')
    await timeline.trigger('click')
    await flushPromises()
    expect(store.config.get('aiUsePlayerNotes')).toBe(false)
    expect(store.config.get('aiUseTimeline')).toBe(false)
  })
})
