/**
 * Header 顶栏升级药丸 + 启动静默检查接线测试
 *
 * useAppUpdate 自身的行为（manual/silent 通知差异、单例状态、下载失败反馈）
 * 已在 composables/useAppUpdate.spec.ts 覆盖，这里只验证 Header 这一层的
 * 接线：药丸显隐跟着 availableUpdate 走、点击药丸直接弹确认框（不重新查询）、
 * 启动静默检查复用 useStartupDialogs 同款「连接建立 + 沉淀」/「兜底超时」
 * 两条路径各触发一次静默检查。
 *
 * @module components/Header
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref, nextTick, type Ref } from 'vue'
import naive from 'naive-ui'

// jsdom 下没有 <n-message-provider>，useMessage 会抛错——替换成共享 mock，
// 沿用 DataSync.cloudConfigEntry.spec.ts 的既有做法
const messageMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve([])) }))
vi.mock('@tauri-apps/api/window', () => ({
  Window: { getCurrent: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }) },
  getCurrentWindow: vi.fn(() => ({ label: 'main' }))
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@renderer/router', () => ({
  default: { push: vi.fn(), currentRoute: { value: { path: '/' } } }
}))
vi.mock('@renderer/services/ipc', () => ({
  closeLeagueByIpc: vi.fn(),
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))

// lcuConnected 必须是真实 Vue ref：Header 内部用 watch(lcuConnected, ...) 监听，
// 传入普通对象 watch 侦测不到 .value 变更（曾踩过，见下方断言全部失败+ 控制台
// "Invalid watch source" 警告）。写法沿用 useStartupDialogs.spec.ts 的既有做法。
vi.mock('@renderer/composables/useGameState', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    lcuConnected: vueRef(false),
    useGameState: () => ({ isConnected: vueRef(false) })
  }
})

const mockAvailableUpdate = ref<{ version: string } | null>(null)
const mockCheckForUpdates = vi.fn()
const mockShowUpdateDialog = vi.fn()
vi.mock('@renderer/composables/useAppUpdate', () => ({
  useAppUpdate: () => ({
    checking: ref(false),
    availableUpdate: mockAvailableUpdate,
    checkForUpdates: mockCheckForUpdates,
    showUpdateDialog: mockShowUpdateDialog
  })
}))

import Header from '../Header.vue'
import { lcuConnected } from '@renderer/composables/useGameState'
import { GATE_SETTLE_MS, GATE_FALLBACK_MS } from '@renderer/composables/useStartupDialogs'

/** mock 后的 lcuConnected 实际是可写 ref，收窄类型便于测试赋值 */
const mockConnected = lcuConnected as unknown as Ref<boolean>

describe('Header 顶栏升级药丸', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockAvailableUpdate.value = null
    mockCheckForUpdates.mockClear()
    mockShowUpdateDialog.mockClear()
    mockConnected.value = false
  })

  it('没有可用更新时不渲染药丸，不占位', async () => {
    const w = mount(Header, { global: { plugins: [naive] } })
    await nextTick()
    expect(w.find('.update-pill').exists()).toBe(false)
    w.unmount()
  })

  it('探测到更新后渲染药丸，文案带版本号', async () => {
    mockAvailableUpdate.value = { version: '1.2.3' }
    const w = mount(Header, { global: { plugins: [naive] } })
    await nextTick()
    const pill = w.find('.update-pill')
    expect(pill.exists()).toBe(true)
    expect(pill.text()).toContain('新版 v1.2.3')
    w.unmount()
  })

  it('点击药丸直接弹确认框，不重新触发一次查询', async () => {
    const update = { version: '1.2.3' }
    mockAvailableUpdate.value = update
    const w = mount(Header, { global: { plugins: [naive] } })
    await nextTick()

    await w.find('.update-pill').trigger('click')

    expect(mockShowUpdateDialog).toHaveBeenCalledWith(update)
    expect(mockCheckForUpdates).not.toHaveBeenCalledWith('manual')
    w.unmount()
  })
})

describe('Header 启动静默检查', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockAvailableUpdate.value = null
    mockCheckForUpdates.mockClear()
    mockConnected.value = false
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('LCU 已连接：等 GATE_SETTLE_MS 沉淀后静默查一次', async () => {
    mockConnected.value = true
    const w = mount(Header, { global: { plugins: [naive] } })
    await nextTick()

    vi.advanceTimersByTime(GATE_SETTLE_MS - 1)
    expect(mockCheckForUpdates).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1)
    expect(mockCheckForUpdates).toHaveBeenCalledWith('silent')
    w.unmount()
  })

  it('一直未连接：靠 GATE_FALLBACK_MS 兜底触发静默查', async () => {
    const w = mount(Header, { global: { plugins: [naive] } })
    await nextTick()

    vi.advanceTimersByTime(GATE_FALLBACK_MS - 1)
    expect(mockCheckForUpdates).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1 + GATE_SETTLE_MS)
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1)
    expect(mockCheckForUpdates).toHaveBeenCalledWith('silent')
    w.unmount()
  })

  it('连接在兜底超时前建立：只触发一次，兜底计时器到点不再重复触发', async () => {
    const w = mount(Header, { global: { plugins: [naive] } })
    await nextTick()

    vi.advanceTimersByTime(100)
    mockConnected.value = true
    await nextTick()
    vi.advanceTimersByTime(GATE_SETTLE_MS)
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1)

    // 时间推进到原本的兜底触发点，不应该再触发第二次
    vi.advanceTimersByTime(GATE_FALLBACK_MS)
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})
