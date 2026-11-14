/**
 * 常规设置「分享对局判断」开关：读取配置、写回配置、开启时补传本地标注。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import naive, { NMessageProvider } from 'naive-ui'
import { defineComponent, h } from 'vue'
import General from '../General.vue'

const store = vi.hoisted(() => ({ config: new Map<string, unknown>(), retry: vi.fn() }))

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: async (k: string) => store.config.get(k),
  putConfigByIpc: async (k: string, v: unknown) => void store.config.set(k, v)
}))
vi.mock('@renderer/services/matchLabel', () => ({
  MATCH_LABEL_SHARE_KEY: 'matchLabelShare',
  retryMatchLabelUploads: store.retry
}))
vi.mock('../AiProviderPicker.vue', () => ({ default: defineComponent({ render: () => null }) }))

function mountGeneral() {
  return mount(defineComponent({ render: () => h(NMessageProvider, () => h(General)) }), {
    global: { plugins: [naive] }
  })
}

beforeEach(() => {
  store.config.clear()
  store.retry.mockReset().mockResolvedValue(2)
})

describe('分享对局判断开关', () => {
  it('未决定时显示为关', async () => {
    const w = mountGeneral()
    await flushPromises()
    expect(w.get('[data-test="match-label-share"]').classes()).not.toContain('n-switch--active')
  })

  it('已同意时显示为开', async () => {
    store.config.set('matchLabelShare', true)
    const w = mountGeneral()
    await flushPromises()
    expect(w.get('[data-test="match-label-share"]').classes()).toContain('n-switch--active')
  })

  it('打开：写配置并补传本地标注；关闭：只写配置', async () => {
    const w = mountGeneral()
    await flushPromises()
    await w.get('[data-test="match-label-share"]').trigger('click')
    await flushPromises()
    expect(store.config.get('matchLabelShare')).toBe(true)
    expect(store.retry).toHaveBeenCalledTimes(1)
    await w.get('[data-test="match-label-share"]').trigger('click')
    await flushPromises()
    expect(store.config.get('matchLabelShare')).toBe(false)
    expect(store.retry).toHaveBeenCalledTimes(1)
  })
})
