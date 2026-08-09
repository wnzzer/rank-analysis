/**
 * SideNavigation「设置」导航项 · 云端配置待裁决角标回归测试
 *
 * 背景：云端配置拉取裁决弹窗（CloudConfigPullDialog）不再自动弹出，改成被动
 * 角标引导——待裁决时左侧导航「设置」项挂一枚绿色呼吸角标，裁决完（
 * pendingCloudConfig 归 null）立即消失。角标本体（颜色/呼吸动效）在
 * global.css 的 .pending-badge-dot，本文件只验证显隐逻辑接线正确。
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

import { useCloudSyncStore } from '@renderer/pinia/cloudSync'
import SideNavigation from '../SideNavigation.vue'

describe('SideNavigation 设置导航项的待裁决角标', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('pendingCloudConfig 有值时展示角标', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1, config: {} }
    const w = mount(SideNavigation, { global: { plugins: [naive] } })
    await w.vm.$nextTick()
    expect(w.find('.pending-badge-dot').exists()).toBe(true)
    w.unmount()
  })

  it('无待裁决配置时不展示角标', async () => {
    const w = mount(SideNavigation, { global: { plugins: [naive] } })
    await w.vm.$nextTick()
    expect(w.find('.pending-badge-dot').exists()).toBe(false)
    w.unmount()
  })

  it('裁决后（pendingCloudConfig 归 null）角标立即消失', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1, config: {} }
    const w = mount(SideNavigation, { global: { plugins: [naive] } })
    await w.vm.$nextTick()
    expect(w.find('.pending-badge-dot').exists()).toBe(true)

    store.pendingCloudConfig = null
    await w.vm.$nextTick()
    expect(w.find('.pending-badge-dot').exists()).toBe(false)
    w.unmount()
  })
})
