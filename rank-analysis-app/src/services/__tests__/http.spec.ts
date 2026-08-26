/**
 * http 服务单元测试：asset 协议前缀初始化（R29-3）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { assetPrefix, baseURL, initAssetPrefix } from '../http'

describe('http', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to the Windows WebView2 format and empty baseURL', () => {
    expect(assetPrefix).toBe('http://asset.localhost')
    expect(baseURL).toBe('')
  })

  it('adopts the backend-provided prefix on success', async () => {
    vi.mocked(invoke).mockResolvedValue('asset://localhost')
    await initAssetPrefix()
    expect(assetPrefix).toBe('asset://localhost')
    expect(invoke).toHaveBeenCalledWith('get_asset_prefix')
  })

  it('keeps the current prefix and warns when invoke fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(invoke).mockRejectedValue(new Error('not a tauri env'))
    await initAssetPrefix()
    // 失败不回跳默认值，而是保持当前值（catch 分支不赋值）
    expect(assetPrefix).toBe('asset://localhost')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
