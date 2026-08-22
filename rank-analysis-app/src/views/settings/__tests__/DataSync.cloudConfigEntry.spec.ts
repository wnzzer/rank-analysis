/**
 * DataSync.vue · 云端配置拉取裁决入口回归测试
 *
 * 背景：CloudConfigPullDialog 不再随应用启动自动弹出（原来挂在 Framework.vue
 * 的启动弹窗队列里），改成本页顶部的被动提示条——有 pendingCloudConfig 时才
 * 出现，用户点「去处理」才真正弹出裁决框；裁决完（无论选哪边）都要收起弹窗。
 * 裁决框本身与 store.resolveCloudConfig 的正确性已有专门覆盖（分别见
 * autoFocusDialogs.spec.ts 与 pinia/__tests__/cloudSync.spec.ts），本文件只
 * 验证 DataSync.vue 这一层的接线：入口可见性 → 点击开框 → decide 事件转发。
 *
 * @module views/settings/DataSync
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

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
// jsdom 下没有 n-message-provider，替换 useMessage 为共享 mock，
// 与 Automation.tierSelect.spec.ts 等同一约定。
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

import { useCloudSyncStore } from '@renderer/features/settings/stores/cloudSync'
import DataSync from '../DataSync.vue'

/**
 * naive-ui 的 <n-modal> 默认把内容 teleport 到 document.body，vue-test-utils
 * 的 wrapper.text()/find() 不会跟进 teleport 目标（同 Automation.tierSelect.spec.ts
 * 对 <n-select> 的处理），用一个不做 teleport/过渡的最简 stub 替换，只保留
 * v-if(show) 语义——裁决框内部按钮（n-button 等）仍是真实 naive-ui 组件，
 * 照常渲染进 wrapper 自己的子树，方便直接 find。
 */
const stubs = {
  Modal: {
    props: ['show'],
    template: '<div v-if="show"><slot /></div>'
  }
}

function mountDataSync() {
  return mount(DataSync, { global: { plugins: [naive], stubs } })
}

describe('DataSync.vue 云端配置拉取入口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('无待裁决配置时不展示入口提示条，裁决框也不可见', () => {
    const w = mountDataSync()
    expect(w.text()).not.toContain('检测到云端已有一份配置')
    expect(w.text()).not.toContain('云端已有一份配置')
    w.unmount()
  })

  it('有待裁决配置时展示提示条；点「去处理」才弹出裁决框', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1700000000000, config: {} }
    const w = mountDataSync()
    await w.vm.$nextTick()

    expect(w.text()).toContain('检测到云端已有一份配置')
    // 裁决未决期间配置同步整段冻结（syncConfig 见 pendingCloudConfig 非空即
    // return），必须把后果讲清楚：本机改动不推云端 + 最终选云端会覆盖掉这期间
    // 的本机改动，否则用户会以为被动角标可以慢慢处理
    expect(w.text()).toContain('确认前，本机设置的改动不会同步到云端')
    expect(w.text()).toContain('这期间的本机改动会被覆盖')
    // 裁决框组件已挂载，但 show=false，标题文案此刻不应出现在可交互 DOM 里
    expect(w.text()).not.toContain('云端存在一份配置(更新于')

    const goButton = w.findAll('button').find(b => b.text() === '去处理')
    expect(goButton).toBeTruthy()
    await goButton!.trigger('click')

    expect(w.text()).toContain('云端存在一份配置(更新于')
    w.unmount()
  })

  it('裁决框选「使用云端配置」：转发给 store.resolveCloudConfig 并收起弹窗', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1700000000000, config: { theme: 'dark' } }
    const resolveSpy = vi.spyOn(store, 'resolveCloudConfig').mockResolvedValue(undefined)

    const w = mountDataSync()
    await w.vm.$nextTick()
    const goButton = w.findAll('button').find(b => b.text() === '去处理')
    await goButton!.trigger('click')
    expect(w.text()).toContain('云端存在一份配置(更新于')

    const useCloudButton = w.findAll('button').find(b => b.text() === '使用云端配置')
    expect(useCloudButton).toBeTruthy()
    await useCloudButton!.trigger('click')
    await w.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(resolveSpy).toHaveBeenCalledWith(true)
    expect(messageMock.success).toHaveBeenCalledWith('已应用云端配置')
    // 裁决完弹窗要收起——裁决框标题不再出现在可见 DOM 里
    expect(w.text()).not.toContain('云端存在一份配置(更新于')
    w.unmount()
  })

  it('裁决框选「保留本机」：以 false 转发给 store.resolveCloudConfig', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1700000000000, config: {} }
    const resolveSpy = vi.spyOn(store, 'resolveCloudConfig').mockResolvedValue(undefined)

    const w = mountDataSync()
    await w.vm.$nextTick()
    const goButton = w.findAll('button').find(b => b.text() === '去处理')
    await goButton!.trigger('click')

    const keepLocalButton = w.findAll('button').find(b => b.text() === '保留本机')
    expect(keepLocalButton).toBeTruthy()
    await keepLocalButton!.trigger('click')
    await w.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(resolveSpy).toHaveBeenCalledWith(false)
    expect(messageMock.success).toHaveBeenCalledWith('已保留本机配置并推送云端')
    w.unmount()
  })

  it('resolveCloudConfig 失败时给出错误提示，弹窗仍会收起', async () => {
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1700000000000, config: {} }
    vi.spyOn(store, 'resolveCloudConfig').mockRejectedValue(new Error('网络失败'))

    const w = mountDataSync()
    await w.vm.$nextTick()
    const goButton = w.findAll('button').find(b => b.text() === '去处理')
    await goButton!.trigger('click')
    const useCloudButton = w.findAll('button').find(b => b.text() === '使用云端配置')
    await useCloudButton!.trigger('click')
    await w.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(messageMock.error).toHaveBeenCalled()
    expect(w.text()).not.toContain('云端存在一份配置(更新于')
    w.unmount()
  })
})
