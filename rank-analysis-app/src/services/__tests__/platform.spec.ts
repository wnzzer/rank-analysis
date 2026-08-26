/**
 * platform 服务单元测试：平台标识门控与初始化回退（R29-3）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { initPlatform, isWindows, platformOs } from '../platform'

describe('platform', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to windows gating in non-tauri environments', () => {
    expect(platformOs).toBe('windows')
    expect(isWindows()).toBe(true)
  })

  it('reflects the backend-reported os on success', async () => {
    vi.mocked(invoke).mockResolvedValue('macos')
    await initPlatform()
    expect(platformOs).toBe('macos')
    expect(isWindows()).toBe(false)
  })

  it('keeps the current value and warns when invoke fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(invoke).mockRejectedValue(new Error('no backend'))
    await initPlatform()
    expect(platformOs).toBe('macos')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns to windows gating when backend reports windows again', async () => {
    vi.mocked(invoke).mockResolvedValue('windows')
    await initPlatform()
    expect(isWindows()).toBe(true)
  })
})
