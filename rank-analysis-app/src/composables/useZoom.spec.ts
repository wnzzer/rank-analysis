import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { setZoomMock, getConfigMock, putConfigMock } = vi.hoisted(() => ({
  setZoomMock: vi.fn(() => Promise.resolve()),
  getConfigMock: vi.fn(),
  putConfigMock: vi.fn(() => Promise.resolve())
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom: setZoomMock })
}))
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: getConfigMock,
  putConfigByIpc: putConfigMock
}))

import {
  nextZoomFactor,
  isValidZoomFactor,
  zoomDirectionOf,
  createDebouncedSave,
  applySavedWindowZoom,
  ZOOM_MIN,
  ZOOM_MAX
} from './useZoom'

/** 构造只含 zoomDirectionOf 关心字段的事件，避开 jsdom 对 WheelEvent 的差异 */
function wheel(deltaY: number, ctrlKey = true) {
  return { type: 'wheel', deltaY, ctrlKey } as unknown as WheelEvent
}
function key(k: string, mods: Partial<KeyboardEvent> = {}) {
  return {
    type: 'keydown',
    key: k,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    ...mods
  } as KeyboardEvent
}

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

describe('isValidZoomFactor', () => {
  it('should accept numbers within range', () => {
    expect(isValidZoomFactor(1.2)).toBe(true)
  })

  it('should reject out-of-range or non-number values', () => {
    expect(isValidZoomFactor(9)).toBe(false)
    expect(isValidZoomFactor('1.2')).toBe(false)
    expect(isValidZoomFactor(undefined)).toBe(false)
  })
})

describe('zoomDirectionOf', () => {
  it('should ignore events without ctrl', () => {
    expect(zoomDirectionOf(wheel(-100, false))).toBeNull()
  })

  it('should map wheel up to zoom in and wheel down to zoom out', () => {
    expect(zoomDirectionOf(wheel(-100))).toBe(1)
    expect(zoomDirectionOf(wheel(100))).toBe(-1)
  })

  it('should ignore horizontal-only wheel', () => {
    expect(zoomDirectionOf(wheel(0))).toBeNull()
  })

  it('should map ctrl + = / + / - / 0 keys', () => {
    expect(zoomDirectionOf(key('='))).toBe(1)
    expect(zoomDirectionOf(key('+'))).toBe(1)
    expect(zoomDirectionOf(key('-'))).toBe(-1)
    expect(zoomDirectionOf(key('0'))).toBe(0)
  })

  it('should ignore ctrl+alt combos and unrelated keys', () => {
    expect(zoomDirectionOf(key('=', { altKey: true }))).toBeNull()
    expect(zoomDirectionOf(key('a'))).toBeNull()
  })
})

describe('createDebouncedSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    putConfigMock.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should write only the last value after the debounce window', () => {
    const saver = createDebouncedSave('k')
    saver.save(1.1)
    saver.save(1.21)
    vi.advanceTimersByTime(599)
    expect(putConfigMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(putConfigMock).toHaveBeenCalledTimes(1)
    expect(putConfigMock).toHaveBeenCalledWith('k', 1.21)
  })

  it('should flush a pending value immediately', () => {
    const saver = createDebouncedSave('k')
    saver.save(0.9)
    saver.flush()
    expect(putConfigMock).toHaveBeenCalledWith('k', 0.9)
    saver.flush()
    expect(putConfigMock).toHaveBeenCalledTimes(1)
  })
})

describe('applySavedWindowZoom', () => {
  beforeEach(() => {
    setZoomMock.mockClear()
    getConfigMock.mockReset()
  })

  it('should apply a valid saved factor to the webview', async () => {
    getConfigMock.mockResolvedValue(1.2)
    await applySavedWindowZoom()
    expect(setZoomMock).toHaveBeenCalledWith(1.2)
  })

  it('should keep 1x for invalid, missing or default values', async () => {
    for (const saved of [9, undefined, 1]) {
      getConfigMock.mockResolvedValueOnce(saved)
      await applySavedWindowZoom()
    }
    expect(setZoomMock).not.toHaveBeenCalled()
  })

  it('should not throw when reading config fails', async () => {
    getConfigMock.mockRejectedValue(new Error('ipc down'))
    await expect(applySavedWindowZoom()).resolves.toBeUndefined()
  })
})
