/**
 * usePostGameToastNavigation：弹卡发来的跳转只接受白名单路径，已在目标页时不重复 push，卸载时取消监听。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { usePostGameToastNavigation } from '../usePostGameToastNavigation'

const h = vi.hoisted(() => ({
  handler: null as null | ((e: { payload: string }) => void),
  unlisten: vi.fn(),
  push: vi.fn(),
  path: '/Record'
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_: string, fn: (e: { payload: string }) => void) => {
    h.handler = fn
    return h.unlisten
  }
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: h.push, currentRoute: { value: { path: h.path } } })
}))

const Host = defineComponent({
  setup() {
    usePostGameToastNavigation()
    return () => null
  }
})

beforeEach(() => {
  h.handler = null
  h.unlisten.mockReset()
  h.push.mockReset()
  h.path = '/Record'
})

describe('usePostGameToastNavigation', () => {
  it('收到 /Gaming 时跳到对局页', async () => {
    mount(Host)
    await flushPromises()
    h.handler!({ payload: '/Gaming' })
    expect(h.push).toHaveBeenCalledWith('/Gaming')
  })

  it('不在白名单的路径忽略', async () => {
    mount(Host)
    await flushPromises()
    h.handler!({ payload: '/Settings/General' })
    expect(h.push).not.toHaveBeenCalled()
  })

  it('已在对局页不重复 push', async () => {
    h.path = '/Gaming'
    mount(Host)
    await flushPromises()
    h.handler!({ payload: '/Gaming' })
    expect(h.push).not.toHaveBeenCalled()
  })

  it('卸载时取消监听', async () => {
    const w = mount(Host)
    await flushPromises()
    w.unmount()
    expect(h.unlisten).toHaveBeenCalled()
  })
})
