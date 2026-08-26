/**
 * useGameModes 单元测试：全局共享模式列表的拉取与映射（R30-2）。
 * 模块级单例 ref 在用例间需手动复位。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@renderer/services/ipc', () => ({
  getGameModesByIpc: vi.fn()
}))

import { getGameModesByIpc } from '@renderer/services/ipc'
import { initModeOptions, modeOptions } from './useGameModes'

const DEFAULT_MODES = [{ label: '全部', value: 0, key: 0 }]

describe('useGameModes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modeOptions.value = [...DEFAULT_MODES]
  })

  it('starts with the sentinel "全部" option', () => {
    expect(modeOptions.value).toEqual(DEFAULT_MODES)
  })

  it('maps fetched modes and derives key from value', async () => {
    vi.mocked(getGameModesByIpc).mockResolvedValue([
      { label: '排位', value: 420 },
      { label: '大乱斗', value: 450 }
    ])
    await initModeOptions()
    expect(modeOptions.value).toEqual([
      { label: '排位', value: 420, key: 420 },
      { label: '大乱斗', value: 450, key: 450 }
    ])
  })

  it('keeps previous options and logs when fetch fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getGameModesByIpc).mockRejectedValue(new Error('offline'))
    await initModeOptions()
    expect(modeOptions.value).toEqual(DEFAULT_MODES)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('replaces (not merges) the sentinel after a successful load', async () => {
    vi.mocked(getGameModesByIpc).mockResolvedValue([{ label: '排位', value: 420 }])
    await initModeOptions()
    expect(modeOptions.value.some(m => m.label === '全部')).toBe(false)
  })
})
