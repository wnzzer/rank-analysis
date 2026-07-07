/**
 * useCloudSyncStore 单元测试
 * @module pinia/cloudSync
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Ref } from 'vue'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))
// 主窗口判断依赖 window label，jsdom 无 Tauri runtime，默认扮演主窗口
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'main' }))
}))
// LCU 连接状态用可写 ref 顶替，便于测试模拟「连接建立」时刻
vi.mock('@renderer/composables/useGameState', async () => {
  const { ref } = await import('vue')
  return { lcuConnected: ref(false) }
})

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { lcuConnected } from '@renderer/composables/useGameState'
import { useCloudSyncStore } from '../cloudSync'
import { usePlayerNotesStore } from '../playerNotes'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)
/** mock 后的 lcuConnected 实际是可写 ref，收窄类型便于测试赋值 */
const mockConnected = lcuConnected as unknown as Ref<boolean>

/** 让 pending 的 promise 链走完（fake timers 不冻结微任务，循环 await 即可放行） */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** 常规成功路径的 invoke mock：无云端数据，pull 返回空 */
function mockHappyInvoke(): void {
  mockInvoke.mockImplementation(async cmd => {
    if (cmd === 'get_my_summoner') return { puuid: 'me' }
    if (cmd === 'cloud_pull_notes') return []
    return undefined
  })
}

describe('useCloudSyncStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockConnected.value = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('init 读取开关;未开启时不触发同步', async () => {
    mockGet.mockResolvedValue(undefined)
    const store = useCloudSyncStore()
    await store.init()
    expect(store.enabled).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('setEnabled(true) 持久化并触发一次同步', async () => {
    mockGet.mockResolvedValue(undefined)
    mockHappyInvoke()
    const store = useCloudSyncStore()
    await store.setEnabled(true)
    expect(mockPut).toHaveBeenCalledWith('cloudSyncEnabled', true)
    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('cloud_push_notes', expect.anything())
    )
  })

  it('syncNow 拉取多设备 payload、合并进 notes、推送合并结果', async () => {
    mockGet.mockResolvedValue(undefined)
    const notesStore = usePlayerNotesStore()
    await notesStore.setNote('p1', { note: 'local', label: 'normal', gameName: 'A', tagLine: '1' })
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'cloud_pull_notes')
        return [
          { p2: { note: 'remote', label: 'friendly', gameName: 'B', tagLine: '2', updatedAt: 5 } }
        ]
      return undefined
    })
    const store = useCloudSyncStore()
    await store.syncNow()
    expect(notesStore.getNote('p2')?.note).toBe('remote')
    const pushCall = mockInvoke.mock.calls.find(c => c[0] === 'cloud_push_notes')
    expect(pushCall).toBeTruthy()
    const payload = (pushCall![1] as { payload: Record<string, unknown> }).payload
    expect(Object.keys(payload).sort()).toEqual(['p1', 'p2'])
    expect(store.lastSyncAt).not.toBeNull()
  })

  it('同步失败记录 lastError,syncing 复位', async () => {
    mockGet.mockResolvedValue(undefined)
    mockInvoke.mockRejectedValue('云端连接失败: timeout')
    const store = useCloudSyncStore()
    await expect(store.syncNow()).rejects.toBeTruthy()
    expect(store.lastError).toContain('云端连接失败')
    expect(store.syncing).toBe(false)
  })

  it('详情窗口 init 只镜像开关,不触发同步(仅主窗口承担)', async () => {
    vi.mocked(getCurrentWindow).mockReturnValueOnce({
      label: 'match-detail-42'
    } as ReturnType<typeof getCurrentWindow>)
    mockGet.mockResolvedValue(true) // 开关已开启
    mockHappyInvoke()
    const store = useCloudSyncStore()
    await store.init()
    await flushAsync()
    expect(store.enabled).toBe(true)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('启动同步失败后,LCU 连接建立时补触发一次', async () => {
    mockGet.mockResolvedValue(true) // 开关已开启
    mockInvoke.mockRejectedValue('LCU 未连接')
    const store = useCloudSyncStore()
    await store.init()
    await flushAsync()
    expect(store.lastSyncAt).toBeNull()
    expect(store.lastError).toContain('LCU 未连接')

    mockInvoke.mockReset()
    mockHappyInvoke()
    mockConnected.value = true
    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('cloud_push_notes', expect.anything())
    )
    await vi.waitFor(() => expect(store.lastSyncAt).not.toBeNull())
  })

  describe('防抖推送(fake timers)', () => {
    it('开启后连续多次 setNote,30s 后只推送一次(timer 重置生效)', async () => {
      vi.useFakeTimers()
      mockGet.mockResolvedValue(undefined)
      mockHappyInvoke()
      const store = useCloudSyncStore()
      const notesStore = usePlayerNotesStore()
      await store.setEnabled(true)
      await flushAsync() // 让 setEnabled 触发的立即同步先落定
      mockInvoke.mockClear()

      await notesStore.setNote('a', { note: '1', label: 'normal', gameName: 'A', tagLine: '1' })
      await notesStore.setNote('b', { note: '2', label: 'normal', gameName: 'B', tagLine: '2' })
      await notesStore.setNote('c', { note: '3', label: 'normal', gameName: 'C', tagLine: '3' })

      await vi.advanceTimersByTimeAsync(30_000)
      await flushAsync()
      const pushes = mockInvoke.mock.calls.filter(c => c[0] === 'cloud_push_notes')
      expect(pushes.length).toBe(1)
    })

    it('未开启时 notes 变更不触发任何云端调用', async () => {
      vi.useFakeTimers()
      mockGet.mockResolvedValue(undefined)
      const store = useCloudSyncStore()
      await store.init() // enabled=false,防抖 watch 未启动
      const notesStore = usePlayerNotesStore()
      await notesStore.setNote('a', { note: '1', label: 'normal', gameName: 'A', tagLine: '1' })

      await vi.advanceTimersByTimeAsync(30_000)
      await flushAsync()
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })
})
