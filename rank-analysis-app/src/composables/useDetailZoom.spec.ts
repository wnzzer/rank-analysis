import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'

const { getConfigMock, putConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  putConfigMock: vi.fn(() => Promise.resolve())
}))
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: getConfigMock,
  putConfigByIpc: putConfigMock
}))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ setZoom: vi.fn() }) }))

import { computeDetailScale, useDetailZoom, DETAIL_FIT_MIN, DETAIL_FIT_MAX } from './useDetailZoom'

describe('computeDetailScale', () => {
  it('should stay about 1x in the default 1300x900 window', () => {
    expect(computeDetailScale(1300, 872, 810, 1)).toBeCloseTo(1.016, 3)
  })

  it('should be bounded by height when maximized so all 10 players fit', () => {
    expect(computeDetailScale(2485, 1323, 845, 1)).toBeCloseTo(1.566, 3)
  })

  it('should not shrink for tall content and scroll instead', () => {
    expect(computeDetailScale(1300, 872, 1800, 1)).toBe(1)
  })

  it('should clamp to the minimum in tiny windows', () => {
    expect(computeDetailScale(700, 500, 810, 1)).toBe(DETAIL_FIT_MIN)
  })

  it('should clamp to the maximum on huge screens', () => {
    expect(computeDetailScale(5000, 4000, 810, 1)).toBe(DETAIL_FIT_MAX)
  })

  it('should multiply the user factor on top of fit', () => {
    expect(computeDetailScale(1300, 872, 810, 1.1)).toBeCloseTo(1.117, 3)
  })

  it('should fit width only before content is measured', () => {
    expect(computeDetailScale(1300, 872, 0, 1)).toBeCloseTo(1.016, 3)
  })
})

/** 挂一个最小宿主组件，把 jsdom 里恒为 0 的尺寸换成给定值 */
function mountHarness(size: { availW: number; availH: number; contentH: number }) {
  let api!: ReturnType<typeof useDetailZoom>
  const Harness = defineComponent({
    setup() {
      const area = ref<HTMLElement | null>(null)
      const container = ref<HTMLElement | null>(null)
      api = useDetailZoom({ area, container })
      return () => h('div', { ref: area }, [h('div', { ref: container })])
    }
  })
  const wrapper = mount(Harness, { attachTo: document.body })
  const areaEl = wrapper.element as HTMLElement
  const containerEl = areaEl.firstElementChild as HTMLElement
  Object.defineProperty(areaEl, 'clientWidth', { configurable: true, get: () => size.availW })
  Object.defineProperty(areaEl, 'clientHeight', { configurable: true, get: () => size.availH })
  Object.defineProperty(containerEl, 'scrollHeight', {
    configurable: true,
    get: () => size.contentH
  })
  return { wrapper, api, containerEl }
}

describe('useDetailZoom', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    putConfigMock.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should apply the fitted scale and pin the visual height to the window', () => {
    const { api, containerEl, wrapper } = mountHarness({
      availW: 2485,
      availH: 1323,
      contentH: 845
    })
    api.recompute()
    expect(api.scale.value).toBeCloseTo(1.566, 3)
    expect(parseFloat(containerEl.style.height)).toBeCloseTo(1323 / 1.566, 1)
    wrapper.unmount()
  })

  it('should zoom on ctrl+=, show a percentage badge and persist the factor', async () => {
    vi.useFakeTimers()
    const { api, wrapper } = mountHarness({ availW: 1300, availH: 872, contentH: 810 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }))
    expect(api.userFactor.value).toBe(1.1)
    expect(api.scale.value).toBeCloseTo(1.117, 3)
    expect(api.badge.value).toBe('110%')
    await vi.advanceTimersByTimeAsync(1300)
    expect(api.badge.value).toBeNull()
    expect(putConfigMock).toHaveBeenCalledWith('settings.ui.detailZoomFactor', 1.1)
    wrapper.unmount()
  })

  it('should restore a valid saved factor and ignore invalid ones', async () => {
    const { api, wrapper } = mountHarness({ availW: 1300, availH: 872, contentH: 810 })
    getConfigMock.mockResolvedValueOnce(1.2)
    await api.loadSavedFactor()
    expect(api.userFactor.value).toBe(1.2)
    getConfigMock.mockResolvedValueOnce(9)
    await api.loadSavedFactor()
    expect(api.userFactor.value).toBe(1.2)
    wrapper.unmount()
  })
})
