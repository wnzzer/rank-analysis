/**
 * 选了自定义接入点时请求发往哪里：用户填的地址与密钥，不看模型名前缀；没配完直接报错不发请求。
 * 以及 endpoint.ts 的两个探测调用。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { CUSTOM_ENDPOINT_INCOMPLETE, requestAIContentStream } from '../stream'
import { formatElapsed, listAiModels, testAiEndpoint } from '../endpoint'

const store = vi.hoisted(() => ({ config: new Map<string, unknown>() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }))
vi.mock('../../ipc', () => ({
  getConfigByIpc: async (k: string) => store.config.get(k),
  putConfigByIpc: vi.fn()
}))

const mockInvoke = invoke as ReturnType<typeof vi.fn>

function callbacks() {
  const errors: string[] = []
  return { errors, onChunk: () => {}, onDone: () => {}, onError: (e: string) => errors.push(e) }
}

const streamRequests = () =>
  mockInvoke.mock.calls.filter(c => c[0] === 'stream_ai_analysis').map(c => c[1].request)

beforeEach(() => {
  store.config.clear()
  mockInvoke.mockReset().mockResolvedValue(undefined)
})

describe('自定义接入点的请求', () => {
  beforeEach(() => {
    store.config.set('aiProvider', 'custom')
    store.config.set('aiCustomBaseUrl', ' https://api.example.com/v1 ')
    store.config.set('aiCustomApiKey', 'sk-custom')
    // 内置服务的密钥不该被带到自定义接入点
    store.config.set('dashscopeApiKey', 'sk-ds')
    store.config.set('anthropicApiKey', 'sk-ant')
  })

  it('带上用户填的地址与密钥', async () => {
    await requestAIContentStream('p', callbacks(), 'sys', 'gpt-x')
    expect(streamRequests()[0]).toMatchObject({
      provider: 'custom',
      model: 'gpt-x',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-custom'
    })
  })

  it('不看模型名前缀：叫 claude-xxx 的模型也发往自定义接入点', async () => {
    await requestAIContentStream('p', callbacks(), 'sys', 'claude-opus-5-5')
    expect(streamRequests()[0]).toMatchObject({ provider: 'custom', apiKey: 'sk-custom' })
  })

  it('密钥可空（本机模型）', async () => {
    store.config.set('aiCustomApiKey', '')
    await requestAIContentStream('p', callbacks(), 'sys', 'llama')
    expect(streamRequests()[0].apiKey).toBeUndefined()
  })

  it('调用方没给模型：用自定义接入点的默认模型，而不是内置的模型名', async () => {
    store.config.set('aiModels', { custom: { default: 'gpt-x' } })
    await requestAIContentStream('p', callbacks())
    expect(streamRequests()[0].model).toBe('gpt-x')
  })

  it('没填地址：报错，不发请求', async () => {
    store.config.set('aiCustomBaseUrl', '')
    const cb = callbacks()
    await requestAIContentStream('p', cb, 'sys', 'gpt-x')
    expect(cb.errors).toEqual([CUSTOM_ENDPOINT_INCOMPLETE])
    expect(streamRequests()).toHaveLength(0)
  })

  it('没填模型（resolveModel 返回空串）：报错，不发请求', async () => {
    const cb = callbacks()
    await requestAIContentStream('p', cb, 'sys', '')
    expect(cb.errors).toEqual([CUSTOM_ENDPOINT_INCOMPLETE])
    expect(streamRequests()).toHaveLength(0)
  })
})

describe('内置服务的请求不带地址', () => {
  it('provider 为 dashscope，baseUrl 不传', async () => {
    store.config.set('aiCustomBaseUrl', 'https://api.example.com/v1')
    await requestAIContentStream('p', callbacks(), 'sys', 'qwen-plus')
    expect(streamRequests()[0]).toMatchObject({ provider: 'dashscope', model: 'qwen-plus' })
    expect(streamRequests()[0].baseUrl).toBeUndefined()
  })
})

describe('接入点探测', () => {
  it('listAiModels：空白参数不传；失败返回 null', async () => {
    mockInvoke.mockResolvedValueOnce(['a', 'b'])
    expect(await listAiModels({ baseUrl: '  ', apiKey: '' })).toEqual(['a', 'b'])
    expect(mockInvoke).toHaveBeenCalledWith('list_ai_models', {
      baseUrl: undefined,
      apiKey: undefined
    })

    mockInvoke.mockRejectedValueOnce('404')
    expect(await listAiModels({ baseUrl: 'https://x/v1' })).toBeNull()
  })

  it('testAiEndpoint：IPC 失败折算成不可用', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, ms: 1234, error: null })
    expect(await testAiEndpoint({ baseUrl: 'https://x/v1', apiKey: 'k' }, 'm')).toMatchObject({
      ok: true,
      ms: 1234
    })
    expect(mockInvoke).toHaveBeenCalledWith('test_ai_endpoint', {
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm'
    })

    mockInvoke.mockRejectedValueOnce(new Error('boom'))
    expect(await testAiEndpoint({}, 'm')).toMatchObject({ ok: false, error: 'Error: boom' })
  })

  it('formatElapsed', () => {
    expect(formatElapsed(1234)).toBe('1.2 秒')
    expect(formatElapsed(80)).toBe('0.1 秒')
  })
})
