/**
 * boot.ts · 启动准备顺序测试
 *
 * 守护「首帧即最终态」：prepareBoot 返回时主题已写入 store、主窗口缩放已恢复，
 * main.ts 在其后才 mount。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia } from 'pinia'

const h = vi.hoisted(() => ({
  getConfig: vi.fn(),
  applyZoom: vi.fn(() => Promise.resolve()),
  show: vi.fn(() => Promise.resolve()),
  label: { value: 'main' }
}))

vi.mock('@renderer/services/http', () => ({ initAssetPrefix: vi.fn(() => Promise.resolve()) }))
vi.mock('@renderer/services/platform', () => ({
  initPlatform: vi.fn(() => Promise.resolve()),
  initInstallForm: vi.fn(() => Promise.resolve())
}))
vi.mock('@renderer/services/ipc', () => ({ getConfigByIpc: h.getConfig, putConfigByIpc: vi.fn() }))
vi.mock('@renderer/composables/useZoom', () => ({ applySavedWindowZoom: h.applyZoom }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: h.label.value, show: h.show })
}))

import { prepareBoot, revealMainWindow } from '../boot'
import { useSettingsStore } from '../pinia/setting'

describe('prepareBoot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.label.value = 'main'
    h.getConfig.mockResolvedValue('dark')
  })

  it('should have the saved theme in the store before returning', async () => {
    h.getConfig.mockResolvedValue('light')
    const pinia = createPinia()
    await prepareBoot(pinia)
    expect(useSettingsStore(pinia).theme.name).toBe('light')
  })

  it('should restore the main window zoom before mount', async () => {
    await prepareBoot(createPinia())
    expect(h.applyZoom).toHaveBeenCalledTimes(1)
  })

  it('should leave webview zoom alone in match detail windows', async () => {
    h.label.value = 'match-detail-42'
    await prepareBoot(createPinia())
    expect(h.applyZoom).not.toHaveBeenCalled()
  })
})

describe('revealMainWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show the current window', async () => {
    await revealMainWindow()
    expect(h.show).toHaveBeenCalledTimes(1)
  })

  it('should swallow show failures (Rust side falls back after 3s)', async () => {
    h.show.mockRejectedValueOnce(new Error('denied'))
    await expect(revealMainWindow()).resolves.toBeUndefined()
  })
})
