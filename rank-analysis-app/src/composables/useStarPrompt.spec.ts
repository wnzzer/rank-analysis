/**
 * useStarPrompt 单元测试
 *
 * 覆盖：按天去重计数、阈值与已提示判定、未满天数不弹、满天数在开闸 + 延迟后
 * 弹且先落盘 shown、已提示不再弹、读配置失败既不计数也不弹。
 *
 * @module composables/useStarPrompt
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withSetup } from '@renderer/test-utils/withSetup'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }))

const createMock = vi.fn(() => ({ destroy: vi.fn() }))
vi.mock('naive-ui', async importOriginal => ({
  ...(await importOriginal<typeof import('naive-ui')>()),
  useNotification: () => ({ create: createMock })
}))

const { connected } = vi.hoisted(() => ({ connected: { value: false } }))
vi.mock('@renderer/composables/useGameState', async () => {
  const { ref } = await import('vue')
  const r = ref(false)
  // 测试里通过 connected.value 驱动真正的 ref
  Object.defineProperty(connected, 'value', { get: () => r.value, set: v => (r.value = v) })
  return { lcuConnected: r }
})

import {
  useStarPrompt,
  recordLaunch,
  shouldPrompt,
  localDay,
  STAR_PROMPT_MIN_DAYS,
  STAR_PROMPT_DELAY_MS,
  type StarPromptState
} from './useStarPrompt'
import { GATE_FALLBACK_MS } from './useStartupDialogs'

/** 让 onMounted 里的 await 链跑完 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** 取 put_config 写入 starPrompt 的值列表 */
const putValues = (): StarPromptState[] =>
  invokeMock.mock.calls
    .filter(([cmd, args]) => cmd === 'put_config' && args.key === 'starPrompt')
    .map(([, args]) => args.value.value)

function mockStored(state: StarPromptState | null | Error): void {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_config') {
      if (state instanceof Error) throw state
      return state ? { value: state } : null
    }
  })
}

describe('recordLaunch', () => {
  it('should start counting from first launch', () => {
    expect(recordLaunch(undefined, '2026-10-09')).toEqual({
      days: 1,
      lastDay: '2026-10-09',
      shown: false
    })
  })

  it('should not count the same day twice', () => {
    const s = { days: 3, lastDay: '2026-10-09', shown: false }
    expect(recordLaunch(s, '2026-10-09')).toBe(s)
  })

  it('should count a new day', () => {
    const s = { days: 3, lastDay: '2026-10-08', shown: false }
    expect(recordLaunch(s, '2026-10-09').days).toBe(4)
  })
})

describe('shouldPrompt', () => {
  it('should prompt only after enough days and when not shown', () => {
    expect(shouldPrompt({ days: STAR_PROMPT_MIN_DAYS - 1, lastDay: '', shown: false })).toBe(false)
    expect(shouldPrompt({ days: STAR_PROMPT_MIN_DAYS, lastDay: '', shown: false })).toBe(true)
    expect(shouldPrompt({ days: 99, lastDay: '', shown: true })).toBe(false)
  })
})

describe('localDay', () => {
  it('should format local date as YYYY-MM-DD', () => {
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('useStarPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockReset()
    createMock.mockClear()
    connected.value = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should count launch but not prompt before threshold', async () => {
    mockStored(null)
    withSetup(() => useStarPrompt())
    await flush()
    await vi.advanceTimersByTimeAsync(GATE_FALLBACK_MS + STAR_PROMPT_DELAY_MS)

    expect(putValues()).toEqual([{ days: 1, lastDay: localDay(), shown: false }])
    expect(createMock).not.toHaveBeenCalled()
  })

  it('should prompt once after gate and delay, persisting shown first', async () => {
    mockStored({ days: STAR_PROMPT_MIN_DAYS - 1, lastDay: '2000-01-01', shown: false })
    withSetup(() => useStarPrompt())
    await flush()

    connected.value = true
    await vi.advanceTimersByTimeAsync(STAR_PROMPT_DELAY_MS - 1)
    expect(createMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(GATE_FALLBACK_MS)
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(putValues().at(-1)).toMatchObject({ days: STAR_PROMPT_MIN_DAYS, shown: true })
  })

  it('should not prompt again once shown', async () => {
    mockStored({ days: 30, lastDay: '2000-01-01', shown: true })
    withSetup(() => useStarPrompt())
    await flush()
    await vi.advanceTimersByTimeAsync(GATE_FALLBACK_MS + STAR_PROMPT_DELAY_MS)

    expect(createMock).not.toHaveBeenCalled()
  })

  it('should neither count nor prompt when config read fails', async () => {
    mockStored(new Error('boom'))
    withSetup(() => useStarPrompt())
    await flush()
    await vi.advanceTimersByTimeAsync(GATE_FALLBACK_MS + STAR_PROMPT_DELAY_MS)

    expect(putValues()).toEqual([])
    expect(createMock).not.toHaveBeenCalled()
  })
})
