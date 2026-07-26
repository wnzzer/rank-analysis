/**
 * useStartupDialogs 单元测试
 *
 * 覆盖启动弹窗队列的优先级、首屏就绪闸门、以及裁决后的推进与持久化。
 * mock 骨架沿用 pinia/__tests__/cloudSync.spec.ts：jsdom 无 Tauri runtime，
 * IPC / 事件 / 窗口 / LCU 连接状态全部顶替。
 *
 * @module composables/useStartupDialogs
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/** 窗口 label 需要在单个用例里改写，用 vi.hoisted 越过 vi.mock 的提升 */
const hoisted = vi.hoisted(() => ({ windowLabel: 'main' }))

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: hoisted.windowLabel }))
}))
// LCU 连接状态用可写 ref 顶替，便于模拟「连接建立」时刻
vi.mock('@renderer/composables/useGameState', async () => {
  const { ref } = await import('vue')
  return { lcuConnected: ref(false) }
})

import { getConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { lcuConnected } from '@renderer/composables/useGameState'
import { useCloudSyncStore } from '@renderer/pinia/cloudSync'
import { useStartupDialogs, GATE_SETTLE_MS, GATE_FALLBACK_MS } from './useStartupDialogs'

const mockGet = vi.mocked(getConfigByIpc)
/** mock 后的 lcuConnected 实际是可写 ref，收窄类型便于测试赋值 */
const mockConnected = lcuConnected as unknown as Ref<boolean>

/** 让 pending 的 promise 链走完（fake timers 不冻结微任务，循环 await 即可放行） */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** 让 getConfigByIpc 按键返回指定的「已展示过」标记 */
function mockFlags(notice: boolean | undefined, consent: boolean | undefined): void {
  mockGet.mockImplementation(async (key: string) => {
    if (key === CONFIG_KEYS.cloudSyncNoticeShown) return notice
    if (key === CONFIG_KEYS.errorReportingConsentShown) return consent
    return undefined
  })
}

/** 在组件上下文里跑 composable，拿到返回值与卸载钩子 */
function withSetup<T>(composable: () => T): { result: T; unmount: () => void } {
  let result!: T
  const Wrapper = defineComponent({
    setup() {
      result = composable()
      return () => null
    }
  })
  const wrapper = mount(Wrapper)
  return { result, unmount: () => wrapper.unmount() }
}

/** 挂载并推进到闸门打开（走 8s 兜底路径，不依赖 LCU 连接） */
async function mountWithGateOpen(): Promise<{
  result: ReturnType<typeof useStartupDialogs>
  unmount: () => void
}> {
  const setup = withSetup(() => useStartupDialogs())
  await flushAsync()
  vi.advanceTimersByTime(GATE_FALLBACK_MS)
  vi.advanceTimersByTime(GATE_SETTLE_MS)
  await nextTick()
  return setup
}

describe('useStartupDialogs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockConnected.value = false
    hoisted.windowLabel = 'main'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('新用户：闸门打开后先弹云同步告知', async () => {
    mockFlags(undefined, undefined)
    const { result, unmount } = await mountWithGateOpen()
    expect(result.active.value).toBe('cloudSyncNotice')
    unmount()
  })

  it('云同步已告知过的老用户：直接轮到错误上报同意', async () => {
    mockFlags(true, undefined)
    const { result, unmount } = await mountWithGateOpen()
    expect(result.active.value).toBe('errorReportingConsent')
    unmount()
  })

  it('两个告知都答过时，轮到云端配置拉取', async () => {
    mockFlags(true, true)
    const store = useCloudSyncStore()
    store.pendingCloudConfig = { updatedAt: 1, config: {} }
    const { result, unmount } = await mountWithGateOpen()
    expect(result.active.value).toBe('cloudConfigPull')
    unmount()
  })

  it('闸门：连接建立后要满 500ms 沉淀才开', async () => {
    mockFlags(undefined, undefined)
    const { result, unmount } = withSetup(() => useStartupDialogs())
    await flushAsync()
    expect(result.active.value).toBeNull()

    mockConnected.value = true
    await nextTick()
    expect(result.active.value).toBeNull()

    vi.advanceTimersByTime(GATE_SETTLE_MS)
    await nextTick()
    expect(result.active.value).toBe('cloudSyncNotice')
    unmount()
  })

  it('闸门：一直未连接时靠 8s 兜底开闸', async () => {
    mockFlags(undefined, undefined)
    const { result, unmount } = withSetup(() => useStartupDialogs())
    await flushAsync()

    vi.advanceTimersByTime(GATE_FALLBACK_MS - 1)
    await nextTick()
    expect(result.active.value).toBeNull()

    vi.advanceTimersByTime(1 + GATE_SETTLE_MS)
    await nextTick()
    expect(result.active.value).toBe('cloudSyncNotice')
    unmount()
  })

  it('读配置失败时按「已展示过」跳过本次启动', async () => {
    mockGet.mockRejectedValue(new Error('io'))
    const { result, unmount } = await mountWithGateOpen()
    expect(result.active.value).toBeNull()
    unmount()
  })

  it('战绩详情子窗口不弹任何启动弹窗', async () => {
    hoisted.windowLabel = 'match-detail-42'
    mockFlags(undefined, undefined)
    const { result, unmount } = await mountWithGateOpen()
    expect(result.active.value).toBeNull()
    unmount()
  })
})
