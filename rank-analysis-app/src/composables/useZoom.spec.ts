import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn() })
}))
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))

import { nextZoomFactor, ZOOM_MIN, ZOOM_MAX } from './useZoom'

describe('nextZoomFactor', () => {
  it('should zoom in by one step', () => {
    expect(nextZoomFactor(1, 1)).toBe(1.1)
  })

  it('should zoom out by one step', () => {
    expect(nextZoomFactor(1.1, -1)).toBe(1)
  })

  it('should clamp at max', () => {
    expect(nextZoomFactor(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
  })

  it('should clamp at min', () => {
    expect(nextZoomFactor(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })

  it('should reset to 1 with direction 0', () => {
    expect(nextZoomFactor(1.4, 0)).toBe(1)
  })

  it('should keep two decimals to avoid float drift', () => {
    const zoomed = nextZoomFactor(nextZoomFactor(1, 1), 1)
    expect(String(zoomed).length).toBeLessThanOrEqual(4)
  })
})
