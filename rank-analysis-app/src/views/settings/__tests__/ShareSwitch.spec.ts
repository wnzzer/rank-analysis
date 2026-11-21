/**
 * 「帮助改进 Rank Analysis」：总开关是两个现有配置键的派生状态，子项直接读写原来的键。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import naive, { NMessageProvider } from 'naive-ui'
import { defineComponent, h } from 'vue'
import ShareSwitch from '../ShareSwitch.vue'

const store = vi.hoisted(() => ({
  config: new Map<string, unknown>(),
  puts: [] as [string, unknown][],
  retry: vi.fn()
}))

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: async (k: string) => store.config.get(k),
  putConfigByIpc: async (k: string, v: unknown) => {
    store.puts.push([k, v])
    store.config.set(k, v)
  }
}))
vi.mock('@renderer/services/matchLabel', () => ({
  MATCH_LABEL_SHARE_KEY: 'matchLabelShare',
  retryMatchLabelUploads: store.retry
}))

const ERRORS = 'errorReportingEnabled'
const LABELS = 'matchLabelShare'

async function mountSwitch(errors?: boolean, labels?: boolean): Promise<VueWrapper> {
  if (errors !== undefined) store.config.set(ERRORS, errors)
  if (labels !== undefined) store.config.set(LABELS, labels)
  const w = mount(defineComponent({ render: () => h(NMessageProvider, () => h(ShareSwitch)) }), {
    global: { plugins: [naive] }
  })
  await flushPromises()
  store.puts.length = 0
  return w
}

const master = (w: VueWrapper) => w.get('[data-test="share-master"]')
const item = (w: VueWrapper, name: 'errors' | 'labels') => w.get(`[data-test="share-${name}"]`)
const isOn = (w: VueWrapper) => master(w).classes().includes('n-switch--active')
const isChecked = (w: VueWrapper, name: 'errors' | 'labels') =>
  item(w, name).classes().includes('n-checkbox--checked')
const isDisabled = (w: VueWrapper, name: 'errors' | 'labels') =>
  item(w, name).classes().includes('n-checkbox--disabled')

async function click(el: ReturnType<typeof master>): Promise<void> {
  await el.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  store.config.clear()
  store.puts.length = 0
  store.retry.mockReset().mockResolvedValue(0)
})

describe('初始显示', () => {
  it.each([
    [true, true, true],
    [true, false, true],
    [false, true, true],
    [false, false, false]
  ])('错误报告 %s / 对局判断 %s → 总开关 %s', async (errors, labels, on) => {
    const w = await mountSwitch(errors, labels)
    expect(isOn(w)).toBe(on)
    expect(isChecked(w, 'errors')).toBe(errors)
    expect(isChecked(w, 'labels')).toBe(labels)
  })

  it('两个键都没写过时视为关', async () => {
    const w = await mountSwitch()
    expect(isOn(w)).toBe(false)
  })

  it('总开关关着时子项置灰', async () => {
    const w = await mountSwitch(false, false)
    expect(isDisabled(w, 'errors')).toBe(true)
    expect(isDisabled(w, 'labels')).toBe(true)
  })

  it('总开关开着时子项可点', async () => {
    const w = await mountSwitch(true, false)
    expect(isDisabled(w, 'errors')).toBe(false)
    expect(isDisabled(w, 'labels')).toBe(false)
  })
})

describe('总开关', () => {
  it('关掉：两个键都写 false', async () => {
    const w = await mountSwitch(true, true)
    await click(master(w))
    expect(store.config.get(ERRORS)).toBe(false)
    expect(store.config.get(LABELS)).toBe(false)
    expect(isOn(w)).toBe(false)
  })

  it('关掉后子项仍显示关之前的勾选，再打开恢复成那样', async () => {
    const w = await mountSwitch(true, false)
    await click(master(w))
    expect(isChecked(w, 'errors')).toBe(true)
    expect(isChecked(w, 'labels')).toBe(false)
    expect(isDisabled(w, 'errors')).toBe(true)

    await click(master(w))
    expect(store.config.get(ERRORS)).toBe(true)
    expect(store.config.get(LABELS)).toBe(false)
    expect(isOn(w)).toBe(true)
  })

  it('没有可恢复的勾选时，打开 = 两个都勾', async () => {
    const w = await mountSwitch(false, false)
    await click(master(w))
    expect(store.config.get(ERRORS)).toBe(true)
    expect(store.config.get(LABELS)).toBe(true)
    expect(isChecked(w, 'errors')).toBe(true)
    expect(isChecked(w, 'labels')).toBe(true)
  })

  it('打开时连带打开了对局判断：补传本地标注', async () => {
    const w = await mountSwitch(false, false)
    await click(master(w))
    expect(store.retry).toHaveBeenCalledTimes(1)
  })

  it('恢复的勾选里没有对局判断：不补传', async () => {
    const w = await mountSwitch(true, false)
    await click(master(w))
    await click(master(w))
    expect(store.retry).not.toHaveBeenCalled()
  })
})

describe('子项', () => {
  it('取消一个只写那一个键，总开关仍开', async () => {
    const w = await mountSwitch(true, true)
    await click(item(w, 'labels'))
    expect(store.puts).toEqual([[LABELS, false]])
    expect(isOn(w)).toBe(true)
  })

  it('两个都取消后总开关变关，再打开两个都勾', async () => {
    const w = await mountSwitch(true, true)
    await click(item(w, 'labels'))
    await click(item(w, 'errors'))
    expect(isOn(w)).toBe(false)

    await click(master(w))
    expect(store.config.get(ERRORS)).toBe(true)
    expect(store.config.get(LABELS)).toBe(true)
  })

  it('勾上对局判断：写配置并补传；勾上错误报告：不补传', async () => {
    const w = await mountSwitch(true, false)
    await click(item(w, 'labels'))
    expect(store.puts).toEqual([[LABELS, true]])
    expect(store.retry).toHaveBeenCalledTimes(1)

    const w2 = await mountSwitch(false, true)
    store.retry.mockClear()
    await click(item(w2, 'errors'))
    expect(store.puts).toEqual([[ERRORS, true]])
    expect(store.retry).not.toHaveBeenCalled()
  })
})
