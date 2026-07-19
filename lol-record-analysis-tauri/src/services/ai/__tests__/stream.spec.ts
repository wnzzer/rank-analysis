import { describe, it, expect, vi } from 'vitest'
import type { AiStreamEvent } from '../stream'
import { mapStreamEvent, requestAIContentStream } from '../stream'
import type { StreamCallbacks } from '../types'

// 用可手动驱动的假 Channel 替换真实 IPC，单测 requestAIContentStream 的终态去重。
vi.mock('@tauri-apps/api/core', () => {
  class Channel {
    onmessage: ((e: AiStreamEvent) => void) | null = null
  }
  return { Channel, invoke: vi.fn() }
})
vi.mock('../ipc', () => ({ getConfigByIpc: vi.fn().mockResolvedValue(undefined) }))

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
  } as any
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
})
