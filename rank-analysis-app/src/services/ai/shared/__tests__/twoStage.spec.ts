import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the underlying AI request function
vi.mock('../../stream', () => ({
  requestAIContent: vi.fn(),
  requestAIContentStream: vi.fn()
}))

import { requestAIContent, requestAIContentStream } from '../../stream'
import { runTwoStage } from '../twoStage'

const mockRequest = requestAIContent as ReturnType<typeof vi.fn>
const mockStream = requestAIContentStream as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockRequest.mockReset()
  mockStream.mockReset()
})

describe('runTwoStage', () => {
  it('returns ok when both stages succeed', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: '{"foo": 1}' })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('{"bar":"hi"}')
      callbacks.onDone()
    })

    const result = await runTwoStage<{ foo: number }, { bar: string }>({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: raw => {
          const v = JSON.parse(raw)
          return { ok: true, value: v }
        }
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: s => JSON.stringify(s),
        parse: raw => ({ ok: true, value: JSON.parse(raw) })
      }
    })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.stage1).toEqual({ foo: 1 })
      expect(result.stage2).toEqual({ bar: 'hi' })
    }
  })

  it('returns stage1Error when stage 1 AI fails', async () => {
    mockRequest.mockResolvedValueOnce({ success: false, error: 'network down' })

    const result = await runTwoStage({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: () => ({ ok: true, value: {} })
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: () => 'U2',
        parse: () => ({ ok: true, value: {} })
      }
    })

    expect(result.kind).toBe('stage1Error')
    if (result.kind === 'stage1Error') {
      expect(result.error).toContain('network')
    }
  })

  it('returns stage1ParseError when JSON parse fails', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: 'not json' })

    const result = await runTwoStage({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: () => ({ ok: false, error: 'invalid' })
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: () => 'U2',
        parse: () => ({ ok: true, value: {} })
      }
    })

    expect(result.kind).toBe('stage1ParseError')
  })

  it('retries stage 1 once on parse error', async () => {
    mockRequest
      .mockResolvedValueOnce({ success: true, content: 'invalid' })
      .mockResolvedValueOnce({ success: true, content: '{"foo":2}' })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('{"bar":"ok"}')
      callbacks.onDone()
    })

    let parseCount = 0
    const result = await runTwoStage<{ foo: number }, { bar: string }>({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: raw => {
          parseCount += 1
          if (raw === 'invalid') return { ok: false, error: 'bad' }
          return { ok: true, value: JSON.parse(raw) }
        }
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: s => JSON.stringify(s),
        parse: raw => ({ ok: true, value: JSON.parse(raw) })
      }
    })

    expect(parseCount).toBe(2)
    expect(result.kind).toBe('ok')
  })

  it('returns stage2Error when stage 2 stream fails', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: '{"foo":1}' })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onError('stream broke')
    })

    const result = await runTwoStage<{ foo: number }, { bar: string }>({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: raw => ({ ok: true, value: JSON.parse(raw) })
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: s => JSON.stringify(s),
        parse: raw => ({ ok: true, value: JSON.parse(raw) })
      }
    })

    expect(result.kind).toBe('stage2Error')
    if (result.kind === 'stage2Error') {
      expect(result.stage1).toEqual({ foo: 1 })
    }
  })

  it('skips stage 1 entirely when precomputedStage1 is provided', async () => {
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('{"bar":"hi"}')
      callbacks.onDone()
    })

    const result = await runTwoStage<{ foo: number }, { bar: string }>({
      precomputedStage1: { foo: 42 },
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: () => ({ ok: false, error: 'should not be called' })
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: s => JSON.stringify(s),
        parse: raw => ({ ok: true, value: JSON.parse(raw) })
      }
    })

    expect(mockRequest).not.toHaveBeenCalled()
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.stage1).toEqual({ foo: 42 })
    }
  })

  it('passes jsonMode through to both stages', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: '{"foo":1}' })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('{}')
      callbacks.onDone()
    })

    await runTwoStage<unknown, unknown>({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: () => ({ ok: true, value: {} }),
        jsonMode: true
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: () => 'U2',
        parse: () => ({ ok: true, value: {} }),
        jsonMode: true
      }
    })

    // requestAIContent(prompt, cacheKey, systemPrompt, model, opts)
    expect(mockRequest.mock.calls[0][4]).toEqual({ jsonMode: true })
    // requestAIContentStream(prompt, callbacks, systemPrompt, model, opts)
    expect(mockStream.mock.calls[0][4]).toEqual({ jsonMode: true })
  })

  it('invalidates the stage 1 cacheKey before retrying on parse error', async () => {
    // requestAIContent 会把解析不过的坏产物也写缓存；不失效的话重试只会拿回同一份坏内容
    sessionStorage.setItem('s1_cache_key', 'invalid')
    mockRequest
      .mockResolvedValueOnce({ success: true, content: 'invalid' })
      .mockResolvedValueOnce({ success: true, content: '{"foo":2}' })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('{"bar":"ok"}')
      callbacks.onDone()
    })

    const result = await runTwoStage<{ foo: number }, { bar: string }>({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        cacheKey: 's1_cache_key',
        parse: raw => {
          if (raw === 'invalid') return { ok: false, error: 'bad' }
          return { ok: true, value: JSON.parse(raw) }
        }
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: s => JSON.stringify(s),
        parse: raw => ({ ok: true, value: JSON.parse(raw) })
      }
    })

    expect(result.kind).toBe('ok')
    expect(sessionStorage.getItem('s1_cache_key')).toBeNull()
  })

  it('streamCallback receives chunks during stage 2', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: '{}' })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('hello ')
      callbacks.onChunk('world')
      callbacks.onDone()
    })

    const chunks: string[] = []
    await runTwoStage<unknown, unknown>({
      stage1: {
        systemPrompt: 'S1',
        userPrompt: 'U1',
        parse: () => ({ ok: true, value: {} })
      },
      stage2: {
        buildSystemPrompt: () => 'S2',
        buildUserPrompt: () => 'U2',
        parse: () => ({ ok: true, value: {} }),
        streamCallback: c => chunks.push(c)
      }
    })

    expect(chunks).toEqual(['hello ', 'world'])
  })
})
