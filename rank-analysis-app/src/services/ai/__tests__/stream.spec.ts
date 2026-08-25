import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiStreamEvent } from '../stream'
import {
  DEFAULT_SYSTEM_PROMPT,
  getAiProviderConfig,
  mapStreamEvent,
  requestAIContentStream
} from '../stream'
import type { StreamCallbacks } from '../types'
import { getConfigByIpc } from '../../ipc'

// 用可手动驱动的假 Channel 替换真实 IPC，单测 requestAIContentStream 的终态去重。
vi.mock('@tauri-apps/api/core', () => {
  class Channel {
    onmessage: ((e: AiStreamEvent) => void) | null = null
  }
  return { Channel, invoke: vi.fn() }
})
vi.mock('../../ipc', () => ({ getConfigByIpc: vi.fn().mockResolvedValue(undefined) }))

function makeCallbacks(): StreamCallbacks & {
  chunks: string[]
  done: number
  errors: string[]
} {
  const chunks: string[] = []
  const errors: string[] = []
  let done = 0
  return {
    chunks,
    errors,
    get done() {
      return done
    },
    onChunk: (c: string) => chunks.push(c),
    onDone: () => {
      done++
    },
    onError: (e: string) => errors.push(e)
  }
}

describe('mapStreamEvent', () => {
  it('chunk 事件转发非空 data 到 onChunk', () => {
    const cb = makeCallbacks()
    mapStreamEvent({ event: 'chunk', data: '你好' }, cb)
    expect(cb.chunks).toEqual(['你好'])
  })

  it('done 事件触发 onDone', () => {
    const cb = makeCallbacks()
    mapStreamEvent({ event: 'done' }, cb)
    expect(cb.done).toBe(1)
  })

  it('error 事件把 data 传给 onError，缺省给兜底文案', () => {
    const cb = makeCallbacks()
    mapStreamEvent({ event: 'error', data: '炸了' }, cb)
    mapStreamEvent({ event: 'error' }, cb)
    expect(cb.errors).toEqual(['炸了', 'AI 请求失败'])
  })

  it('usage 事件解析 data JSON 并触发 onUsage', () => {
    const usages: Array<{ promptTokens: number; completionTokens: number; totalTokens: number }> =
      []
    mapStreamEvent(
      { event: 'usage', data: '{"promptTokens":42,"completionTokens":17,"totalTokens":59}' },
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
        onUsage: u => usages.push(u)
      }
    )
    expect(usages).toEqual([{ promptTokens: 42, completionTokens: 17, totalTokens: 59 }])
  })

  it('usage 事件缺 onUsage 或载荷非法时静默丢弃', () => {
    expect(() =>
      mapStreamEvent({ event: 'usage', data: 'not json' }, makeCallbacks())
    ).not.toThrow()
    expect(() => mapStreamEvent({ event: 'usage' }, makeCallbacks())).not.toThrow()
  })
})

describe('requestAIContentStream jsonMode', () => {
  it('jsonMode=true 时 request 带 responseFormat=json_object，缺省不带', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)

    // invoke 还会被配置读取（get_config）调用，只看 stream_ai_analysis 的请求体
    const streamRequests = () =>
      mockInvoke.mock.calls.filter(c => c[0] === 'stream_ai_analysis').map(c => c[1].request)

    await requestAIContentStream('p', makeCallbacks(), 'sys', 'qwen-flash', { jsonMode: true })
    expect(streamRequests()[0].responseFormat).toBe('json_object')

    await requestAIContentStream('p', makeCallbacks())
    expect(streamRequests()[1].responseFormat).toBeUndefined()
  })
})

describe('requestAIContentStream 终态恰好一次', () => {
  it('首个终态后忽略后续 done/error', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    let channel: { onmessage: ((e: AiStreamEvent) => void) | null } = { onmessage: null }
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_cmd: string, args: { onEvent: typeof channel }) => {
        channel = args.onEvent
      }
    )

    const cb = makeCallbacks()
    await requestAIContentStream('p', cb)

    // 模拟后端先发 error，再(异常地)发 done + error：只应触发一次 onError，不触发 onDone
    channel.onmessage?.({ event: 'error', data: '炸了' })
    channel.onmessage?.({ event: 'done' })
    channel.onmessage?.({ event: 'error', data: '又炸' })

    expect(cb.errors).toEqual(['炸了'])
    expect(cb.done).toBe(0)
  })

  it('usage 事件触发 onUsage，不受终态去重影响', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    let channel: { onmessage: ((e: AiStreamEvent) => void) | null } = { onmessage: null }
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_cmd: string, args: { onEvent: typeof channel }) => {
        channel = args.onEvent
      }
    )

    const usages: Array<{ totalTokens: number }> = []
    await requestAIContentStream('p', {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
      onUsage: u => usages.push(u)
    })

    channel.onmessage?.({ event: 'chunk', data: '内容' })
    channel.onmessage?.({
      event: 'usage',
      data: '{"promptTokens":1,"completionTokens":2,"totalTokens":3}'
    })
    channel.onmessage?.({ event: 'done' })
    channel.onmessage?.({
      event: 'usage',
      data: '{"promptTokens":9,"completionTokens":9,"totalTokens":18}'
    })

    expect(usages).toEqual([
      { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      { promptTokens: 9, completionTokens: 9, totalTokens: 18 }
    ])
  })
})

describe('getAiProviderConfig（D-P4 服务商配置归一）', () => {
  const mockGet = vi.mocked(getConfigByIpc)
  const vals = (map: Record<string, string>) =>
    mockGet.mockImplementation(async (key: string) => map[key] as string | undefined)

  beforeEach(() => {
    mockGet.mockReset()
  })

  it('缺省/未知 provider 归一为 dashscope，key 取 dashscopeApiKey', async () => {
    vals({ dashscopeApiKey: 'sk-dash' })
    expect(await getAiProviderConfig()).toEqual({
      provider: 'dashscope',
      baseUrl: '',
      apiKey: 'sk-dash',
      model: ''
    })
    // 未知 provider（老客户端/手填）也归一 dashscope
    vals({ 'ai.provider': 'grok', dashscopeApiKey: 'sk-dash' })
    expect((await getAiProviderConfig()).provider).toBe('dashscope')
  })

  it('openai 用 aiApiKey 与 aiBaseUrl', async () => {
    vals({
      'ai.provider': 'openai',
      'ai.baseUrl': 'https://x.dev/v1',
      'ai.apiKey': 'sk-abc',
      'ai.model': 'deepseek-chat',
      dashscopeApiKey: 'sk-dash'
    })
    expect(await getAiProviderConfig()).toEqual({
      provider: 'openai',
      baseUrl: 'https://x.dev/v1',
      apiKey: 'sk-abc',
      model: 'deepseek-chat'
    })
  })

  it('ollama 免密钥，apiKey 恒为空串（dashscope key 不外泄）', async () => {
    vals({ 'ai.provider': 'ollama', dashscopeApiKey: 'sk-dash' })
    expect(await getAiProviderConfig()).toEqual({
      provider: 'ollama',
      baseUrl: '',
      apiKey: '',
      model: ''
    })
  })

  it('全部键缺失时回退纯默认值', async () => {
    vals({})
    expect(await getAiProviderConfig()).toEqual({
      provider: 'dashscope',
      baseUrl: '',
      apiKey: '',
      model: ''
    })
  })
})

describe('requestAIContentStream 透传服务商配置（D-P4）', () => {
  const mockGet = vi.mocked(getConfigByIpc)

  beforeEach(async () => {
    mockGet.mockReset()
    // invoke 是跨用例共享的 mock，逐用例重置避免拿到上一个请求体
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockReset()
  })

  it('openai 配置透传到 invoke 请求体，模型用配置值', async () => {
    mockGet.mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        'ai.provider': 'openai',
        'ai.baseUrl': 'https://x.dev/v1',
        'ai.model': 'deepseek-chat',
        'ai.apiKey': 'sk-abc'
      }
      return map[key] as string | undefined
    })
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await requestAIContentStream('p', makeCallbacks())
    const calls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      c => c[0] === 'stream_ai_analysis'
    )
    expect(calls[0][1].request).toEqual({
      prompt: 'p',
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: 'deepseek-chat',
      provider: 'openai',
      baseUrl: 'https://x.dev/v1',
      apiKey: 'sk-abc',
      responseFormat: undefined
    })
  })

  it('dashscope 不发 provider/baseUrl；模型回退调用方参数', async () => {
    mockGet.mockImplementation(async () => undefined)
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await requestAIContentStream('p', makeCallbacks(), 'sys', 'qwen-flash')
    const calls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      c => c[0] === 'stream_ai_analysis'
    )
    const req = calls[0][1].request
    expect(req.provider).toBeUndefined()
    expect(req.baseUrl).toBeUndefined()
    expect(req.apiKey).toBeUndefined()
    expect(req.model).toBe('qwen-flash')
    expect(req.systemPrompt).toBe('sys')
  })

  it('ollama 不发 apiKey（免密钥），baseUrl 透传', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'ai.provider') return 'ollama'
      if (key === 'ai.baseUrl') return 'http://127.0.0.1:11434'
      return undefined
    })
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await requestAIContentStream('p', makeCallbacks())
    const calls = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      c => c[0] === 'stream_ai_analysis'
    )
    const req = calls[0][1].request
    expect(req.provider).toBe('ollama')
    expect(req.baseUrl).toBe('http://127.0.0.1:11434')
    expect(req.apiKey).toBeUndefined()
  })
})
