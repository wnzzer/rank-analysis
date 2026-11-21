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

function mountGeneral() {
  return mount(defineComponent({ render: () => h(NMessageProvider, () => h(General)) }), {
    global: { plugins: [naive] }
  })
}

beforeEach(() => {
  store.config.clear()
  store.retry.mockReset().mockResolvedValue(2)
})

describe('分享对局判断（「帮助改进」下的子项，细节见 ShareSwitch.spec.ts）', () => {
  it('未决定时显示为未勾', async () => {
    const w = mountGeneral()
    await flushPromises()
    expect(w.get('[data-test="share-labels"]').classes()).not.toContain('n-checkbox--checked')
  })

  it('已同意时显示为勾上，总开关为开', async () => {
    store.config.set('matchLabelShare', true)
    const w = mountGeneral()
    await flushPromises()
    expect(w.get('[data-test="share-labels"]').classes()).toContain('n-checkbox--checked')
    expect(w.get('[data-test="share-master"]').classes()).toContain('n-switch--active')
  })

  it('勾上：写配置并补传本地标注；取消：只写配置', async () => {
    store.config.set('errorReportingEnabled', true)
    const w = mountGeneral()
    await flushPromises()
    await w.get('[data-test="share-labels"]').trigger('click')
    await flushPromises()
    expect(store.config.get('matchLabelShare')).toBe(true)
    expect(store.retry).toHaveBeenCalledTimes(1)
    await w.get('[data-test="share-labels"]').trigger('click')
    await flushPromises()
    expect(store.config.get('matchLabelShare')).toBe(false)
    expect(store.retry).toHaveBeenCalledTimes(1)
  })
})

describe('赛后右下角弹卡开关', () => {
  it('键不存在时默认开', async () => {
    store.config.set('postGameToast', '')
    const w = mountGeneral()
    await flushPromises()
    expect(w.get('[data-test="postgame-toast-switch"]').classes()).toContain('n-switch--active')
  })

  it('关闭后写回 false，再打开写回 true', async () => {
    const w = mountGeneral()
    await flushPromises()
    await w.get('[data-test="postgame-toast-switch"]').trigger('click')
    await flushPromises()
    expect(store.config.get('postGameToast')).toBe(false)
    await w.get('[data-test="postgame-toast-switch"]').trigger('click')
    await flushPromises()
    expect(store.config.get('postGameToast')).toBe(true)
  })

  it('已关闭时显示为关', async () => {
    store.config.set('postGameToast', false)
    const w = mountGeneral()
    await flushPromises()
    expect(w.get('[data-test="postgame-toast-switch"]').classes()).not.toContain('n-switch--active')
  })
})
