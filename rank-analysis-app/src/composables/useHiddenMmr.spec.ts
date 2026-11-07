import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h as render, ref, type Ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, () => void>(),
  unlisten: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: () => void) => {
    h.listeners.set(name, cb)
    return Promise.resolve(h.unlisten)
  })
}))

import { useHiddenMmr } from './useHiddenMmr'

function mountWith(puuid: Ref<string>, enabled: Ref<boolean>) {
  let api!: ReturnType<typeof useHiddenMmr>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useHiddenMmr(puuid, enabled)
        return () => render('div')
      }
    })
  )
  return { wrapper, api: () => api }
}

describe('useHiddenMmr', () => {
  beforeEach(() => {
    h.invoke.mockReset()
    h.listeners.clear()
    h.unlisten.mockReset()
  })

  it('should not request when viewing someone else', async () => {
    const { api } = mountWith(ref('other'), ref(false))
    await flushPromises()

    expect(h.invoke).not.toHaveBeenCalled()
    expect(api().solo.value).toBeNull()
    expect(api().flex.value).toBeNull()
  })

  it('should load both queues for self', async () => {
    h.invoke.mockImplementation((_cmd: string, args: { queueType: string }) =>
      Promise.resolve(
        args.queueType === 'RANKED_SOLO_5x5'
          ? { status: 'collecting', reason: 'too_few', have: 1, need: 3 }
          : { status: 'hidden' }
      )
    )
    const { api } = mountWith(ref('me'), ref(true))
    await flushPromises()

    expect(h.invoke).toHaveBeenCalledWith('get_hidden_mmr', {
      puuid: 'me',
      queueType: 'RANKED_SOLO_5x5'
    })
    expect(h.invoke).toHaveBeenCalledWith('get_hidden_mmr', {
      puuid: 'me',
      queueType: 'RANKED_FLEX_SR'
    })
    expect(api().solo.value).toEqual({ status: 'collecting', reason: 'too_few', have: 1, need: 3 })
    expect(api().flex.value).toEqual({ status: 'hidden' })
  })

  it('should reload when backend records a new game', async () => {
    h.invoke.mockResolvedValue({ status: 'hidden' })
    mountWith(ref('me'), ref(true))
    await flushPromises()
    expect(h.invoke).toHaveBeenCalledTimes(2)

    h.listeners.get('hidden-mmr-updated')?.()
    await flushPromises()

    expect(h.invoke).toHaveBeenCalledTimes(4)
  })

  it('should clear values when switching to someone else', async () => {
    h.invoke.mockResolvedValue({ status: 'hidden' })
    const enabled = ref(true)
    const { api } = mountWith(ref('me'), enabled)
    await flushPromises()

    enabled.value = false
    await flushPromises()

    expect(api().solo.value).toBeNull()
  })

  it('should stop listening on unmount', async () => {
    const { wrapper } = mountWith(ref('me'), ref(true))
    await flushPromises()

    wrapper.unmount()

    expect(h.unlisten).toHaveBeenCalled()
  })
})
