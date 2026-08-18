/**
 * Settings.vue「数据与同步」菜单项 · 云端配置待裁决角标回归测试
 *
 * 背景同 SideNavigation.badge.spec.ts：CloudConfigPullDialog 改成被动角标引导，
 * 「设置」一级导航之后，还要在设置页里把用户从菜单一路引到「数据与同步」——
 * 有待裁决配置时该菜单项的 label 里挂一枚 .pending-badge-dot。
 *
 * router-view 内容区用 stub 短路掉（不关心具体渲染哪个子页面，避免拖入
 * Automation.vue 等重量级子视图的 onMounted 副作用），只验证左侧菜单本身。
 *
 * @module views/Settings
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
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

import { useCloudSyncStore } from '@renderer/features/settings/stores/cloudSync'
import Settings from '../Settings.vue'

/** 最小路由：Settings.vue 内部用 useRouter/useRoute，挂载需要真实 router 插件 */
function makeRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [{ path: '/', name: 'Settings', component: Settings }]
  })
}

function mountSettings() {
  const router = makeRouter()
  return mount(Settings, {
    global: {
      plugins: [naive, router],
      stubs: { RouterView: true }
    }
  })
}

describe('Settings.vue 数据与同步菜单项的待裁决角标', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('pendingCloudConfig 有值时菜单项带角标', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1, config: {} }
    const w = mountSettings()
    await w.vm.$nextTick()
    expect(w.text()).toContain('数据与同步')
    expect(w.find('.pending-badge-dot').exists()).toBe(true)
    w.unmount()
  })

  it('无待裁决配置时菜单项不带角标', async () => {
    const w = mountSettings()
    await w.vm.$nextTick()
    expect(w.find('.pending-badge-dot').exists()).toBe(false)
    w.unmount()
  })

  it('裁决后角标立即消失', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1, config: {} }
    const w = mountSettings()
    await w.vm.$nextTick()
    expect(w.find('.pending-badge-dot').exists()).toBe(true)

    store.pendingCloudConfig = null
    await w.vm.$nextTick()
    expect(w.find('.pending-badge-dot').exists()).toBe(false)
    w.unmount()
  })
})
