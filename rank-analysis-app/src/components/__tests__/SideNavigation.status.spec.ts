/**
 * SideNavigation 连接状态灯回归测试
 *
 * 背景：设置 / 英雄页是 offlineCapable，断开态下不会被自动推回 Loading；未连接时
 * 战绩/对局入口隐藏，若状态灯也禁用，从 Loading 进了设置就再也回不去。修复后
 * 状态灯未连接时可点、回 Loading，已连接时进自己的战绩。
 *
 * @module components/SideNavigation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'main' }))
}))

const { state } = vi.hoisted(() => ({
  state: { summoner: null as null | { gameName: string; tagLine: string } }
}))
vi.mock('@renderer/composables/useGameState', async () => {
  const { ref } = await import('vue')
  return {
    useGameState: () => ({ summoner: ref(state.summoner), currentPhase: ref(null) })
  }
})

import router from '../../router'
import SideNavigation from '../SideNavigation.vue'

/** 连接状态灯（底部第一个状态按钮） */
const findStatus = (w: ReturnType<typeof mount>) => w.findAll('.status-icon-btn')[0]

describe('SideNavigation 连接状态灯', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    state.summoner = null
  })

  it('未连接时可点，点击回 Loading 页', async () => {
    const push = vi.spyOn(router, 'push').mockResolvedValue(undefined)
    const w = mount(SideNavigation, { global: { plugins: [naive] } })

    const status = findStatus(w)
    expect(status.attributes('disabled')).toBeUndefined()
    await status.trigger('click')

    expect(push).toHaveBeenCalledWith({ path: '/Loading' })
    w.unmount()
    push.mockRestore()
  })

  it('已连接时点击进入自己的战绩', async () => {
    state.summoner = { gameName: 'Foo', tagLine: '123' }
    const push = vi.spyOn(router, 'push').mockResolvedValue(undefined)
    const w = mount(SideNavigation, { global: { plugins: [naive] } })

    await findStatus(w).trigger('click')

    expect(push).toHaveBeenCalledWith({ path: '/Record', query: { name: 'Foo#123' } })
    w.unmount()
    push.mockRestore()
  })
})
