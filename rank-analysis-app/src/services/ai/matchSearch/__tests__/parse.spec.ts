import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@renderer/services/ai/stream', () => ({
  requestAIContent: vi.fn(),
  DEFAULT_MODEL: 'qwen-flash'
}))
vi.mock('@renderer/services/ipc', () => ({
  getGameModesByIpc: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { requestAIContent } from '@renderer/services/ai/stream'
import { getGameModesByIpc } from '@renderer/services/ipc'
import { extractJson, parseMatchQuery, __resetParseCachesForTests } from '../parse'

const mockInvoke = invoke as ReturnType<typeof vi.fn>
const mockRequest = requestAIContent as ReturnType<typeof vi.fn>
const mockModes = getGameModesByIpc as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockInvoke.mockReset()
  mockRequest.mockReset()
  mockModes.mockReset()
  __resetParseCachesForTests()
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'get_champion_options') {
      return [
        { value: 51, label: '皮城女警', nickname: '女警 (Caitlyn)', realName: '凯特琳' },
        { value: 222, label: '暴走萝莉', nickname: '金克丝 (Jinx)', realName: '金克丝' }
      ]
    }
    throw new Error(`unexpected cmd ${cmd}`)
  })
  mockModes.mockResolvedValue([
    { label: '全部', value: 0 },
    { label: '单双排位', value: 420 }
  ])
})

describe('extractJson', () => {
  it('裸 JSON 直接解析', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('容忍 ```json 围栏与前后闲话', () => {
    expect(extractJson('好的,结果如下:\n```json\n{"a":1}\n```\n请查收')).toEqual({ a: 1 })
  })

  it('无 JSON 时返回 null', () => {
    expect(extractJson('我不知道')).toBeNull()
  })
})

describe('parseMatchQuery', () => {
  it('happy path:jsonMode 调用 → 校验后的查询对象', async () => {
    mockRequest.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        timeRange: { from: '2026-08-01', to: '2026-08-31' },
        selfChampionIds: [51],
        allyChampionIds: [222],
        result: 'win',
        intent: 'list'
      })
    })
    const q = await parseMatchQuery('这个月我用女警队友金克丝赢的')
    expect(q.selfChampionIds).toEqual([51])
    expect(q.allyChampionIds).toEqual([222])
    expect(q.result).toBe('win')
    // jsonMode 必须开启
    const opts = mockRequest.mock.calls[0].at(-1)
    expect(opts).toMatchObject({ jsonMode: true })
  })

  it('模型编造的英雄 id 被清单过滤掉', async () => {
    mockRequest.mockResolvedValue({
      success: true,
      content: JSON.stringify({ selfChampionIds: [51, 9999] })
    })
    const q = await parseMatchQuery('随便')
    expect(q.selfChampionIds).toEqual([51])
  })

  it('AI 请求失败时抛出可展示错误', async () => {
    mockRequest.mockResolvedValue({ success: false, error: '网络错误' })
    await expect(parseMatchQuery('x')).rejects.toThrow('网络错误')
  })

  it('返回内容不是 JSON 时抛错', async () => {
    mockRequest.mockResolvedValue({ success: true, content: '抱歉我做不到' })
    await expect(parseMatchQuery('x')).rejects.toThrow()
  })

  it('英雄/模式清单只加载一次(模块级缓存)', async () => {
    mockRequest.mockResolvedValue({ success: true, content: '{}' })
    await parseMatchQuery('a')
    await parseMatchQuery('b')
    const championCalls = mockInvoke.mock.calls.filter(c => c[0] === 'get_champion_options')
    expect(championCalls).toHaveLength(1)
    expect(mockModes).toHaveBeenCalledTimes(1)
  })
})
