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

/** 常规成功路径的 invoke mock:云端无数据,pull 均返回空 */
function mockHappyInvoke(): void {
  mockInvoke.mockImplementation(async cmd => {
    if (cmd === 'get_my_summoner') return { puuid: 'me' }
    if (cmd === 'cloud_pull_notes') return []
    if (cmd === 'cloud_pull_config') return null
    if (cmd === 'get_cloud_config_snapshot') return {}
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
      expect(mockInvoke).toHaveBeenCalledWith('cloud_pull_notes', expect.anything())
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

  it('pull 回的畸形 payload（null/数组/字符串）被跳过,合法 payload 正常并入,push 照常', async () => {
    mockGet.mockResolvedValue(undefined)
    const notesStore = usePlayerNotesStore()
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'cloud_pull_notes')
        // 云端行任何人可插入:jsonb 列可存 null/数组/原始值,容器必须当不可信输入
        return [
          null,
          [1, 2],
          'str',
          { p2: { note: 'ok', label: 'friendly', gameName: 'B', tagLine: '2', updatedAt: 5 } }
        ]
      return undefined
    })
    const store = useCloudSyncStore()
    await expect(store.syncNow()).resolves.toBeUndefined()
    expect(notesStore.getNote('p2')?.note).toBe('ok')
    // 本地无云端缺的内容（合并后与云端并集一致），按需推送策略下不再 upsert
    expect(mockInvoke.mock.calls.some(c => c[0] === 'cloud_push_notes')).toBe(false)
    expect(store.lastError).toBeNull()
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
      expect(mockInvoke).toHaveBeenCalledWith('cloud_pull_notes', expect.anything())
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

    it('挂起防抖期间关闭开关,30s 后不再推送(隐私契约)', async () => {
      vi.useFakeTimers()
      mockGet.mockResolvedValue(undefined)
      mockHappyInvoke()
      const store = useCloudSyncStore()
      const notesStore = usePlayerNotesStore()
      await store.setEnabled(true)
      await flushAsync()

      await notesStore.setNote('a', { note: '1', label: 'normal', gameName: 'A', tagLine: '1' })
      // 30s 防抖窗口内用户关掉开关：挂起的推送必须被取消
      await store.setEnabled(false)
      mockInvoke.mockClear()

      await vi.advanceTimersByTimeAsync(30_000)
      await flushAsync()
      expect(mockInvoke).not.toHaveBeenCalled()
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

  describe('同步流程整形(单次落盘/按需推送/不自触发)', () => {
    it('多设备行内存合并后,notes 只落盘一次', async () => {
      mockGet.mockResolvedValue(undefined)
      mockInvoke.mockImplementation(async cmd => {
        if (cmd === 'get_my_summoner') return { puuid: 'me' }
        if (cmd === 'cloud_pull_notes')
          return [
            { p2: { note: 'dev-a', label: 'friendly', gameName: 'B', tagLine: '2', updatedAt: 5 } },
            { p3: { note: 'dev-b', label: 'normal', gameName: 'C', tagLine: '3', updatedAt: 6 } }
          ]
        return undefined
      })
      const store = useCloudSyncStore()
      const notesStore = usePlayerNotesStore()
      await store.syncNow()
      expect(notesStore.getNote('p2')?.note).toBe('dev-a')
      expect(notesStore.getNote('p3')?.note).toBe('dev-b')
      const notePersists = mockPut.mock.calls.filter(c => c[0] === 'playerNotes')
      expect(notePersists.length).toBe(1)
    })

    it('无任何变化的同步跳过 cloud_push_notes(不打无谓 upsert)', async () => {
      mockGet.mockResolvedValue(undefined)
      mockHappyInvoke()
      const store = useCloudSyncStore()
      await store.syncNow()
      expect(mockInvoke.mock.calls.some(c => c[0] === 'cloud_push_notes')).toBe(false)
      expect(store.lastSyncAt).not.toBeNull()
    })

    it('本地有云端缺的内容时照常推送', async () => {
      mockGet.mockResolvedValue(undefined)
      mockHappyInvoke()
      const notesStore = usePlayerNotesStore()
      await notesStore.setNote('p1', { note: 'l', label: 'normal', gameName: 'A', tagLine: '1' })
      const store = useCloudSyncStore()
      await store.syncNow()
      expect(mockInvoke.mock.calls.some(c => c[0] === 'cloud_push_notes')).toBe(true)
    })

    it('同步并入的远端变更不自触发下一轮防抖同步', async () => {
      vi.useFakeTimers()
      mockGet.mockResolvedValue(undefined)
      mockInvoke.mockImplementation(async cmd => {
        if (cmd === 'get_my_summoner') return { puuid: 'me' }
        if (cmd === 'cloud_pull_notes')
          return [
            { p2: { note: 'remote', label: 'friendly', gameName: 'B', tagLine: '2', updatedAt: 5 } }
          ]
        if (cmd === 'cloud_pull_config') return null
        if (cmd === 'get_cloud_config_snapshot') return {}
        return undefined
      })
      const store = useCloudSyncStore()
      await store.setEnabled(true) // 启动防抖监听 + 立即同步(并入 p2)
      await flushAsync()
      mockInvoke.mockClear()

      await vi.advanceTimersByTimeAsync(31_000)
      await flushAsync()
      // 旧实现:watcher 观察 notes 引用,sync 自己的合并也会调度 30s 后再同步一轮
      expect(mockInvoke.mock.calls.some(c => c[0] === 'cloud_pull_notes')).toBe(false)
    })

    it('用户 setNote 仍会调度防抖同步(信号未被误杀)', async () => {
      vi.useFakeTimers()
      mockGet.mockResolvedValue(undefined)
      mockHappyInvoke()
      const store = useCloudSyncStore()
      const notesStore = usePlayerNotesStore()
      await store.setEnabled(true)
      await flushAsync()
      mockInvoke.mockClear()

      await notesStore.setNote('a', { note: '1', label: 'normal', gameName: 'A', tagLine: '1' })
      await vi.advanceTimersByTimeAsync(31_000)
      await flushAsync()
      expect(mockInvoke.mock.calls.some(c => c[0] === 'cloud_pull_notes')).toBe(true)
    })
  })

  describe('配置同步', () => {
    /** 按键名精确 mock getConfigByIpc:开关开、首次标记与 LWW 基准可注入 */
    function mockGetConfig(over: Record<string, unknown> = {}): void {
      mockGet.mockImplementation(async key => {
        if (key === 'cloudSyncEnabled') return true
        if (key in over) return over[key]
        return undefined
      })
    }

    /** 组合 invoke mock:云端配置/本地快照可注入 */
    function mockConfigInvoke(opts: {
      pulled?: { updatedAt: number; config: Record<string, unknown> } | null
      local?: Record<string, unknown>
    }): void {
      mockInvoke.mockImplementation(async cmd => {
        if (cmd === 'get_my_summoner') return { puuid: 'me' }
        if (cmd === 'cloud_pull_notes') return []
        if (cmd === 'cloud_pull_config') return opts.pulled ?? null
        if (cmd === 'get_cloud_config_snapshot') return opts.local ?? {}
        return undefined
      })
    }

    it('首次同步:云端有配置且不一致 → 设置 pendingCloudConfig,不静默应用', async () => {
      mockGetConfig({ configSyncedOnce: undefined })
      mockConfigInvoke({
        pulled: { updatedAt: 100, config: { theme: { value: 'dark' } } },
        local: { theme: { value: 'light' } }
      })
      const store = useCloudSyncStore()
      await store.syncNow()
      expect(store.pendingCloudConfig).not.toBeNull()
      expect(mockInvoke).not.toHaveBeenCalledWith('apply_config_snapshot', expect.anything())
      // 弹窗未决前不写首次标记:中途关 app 下次重新走首次流程
      expect(mockPut).not.toHaveBeenCalledWith('configSyncedOnce', true)
    })

    it('首次同步:确认覆盖 → apply + 写首次标记与 LWW 基准', async () => {
      mockGetConfig({ configSyncedOnce: undefined })
      mockConfigInvoke({
        pulled: { updatedAt: 100, config: { theme: { value: 'dark' } } },
        local: { theme: { value: 'light' } }
      })
      const store = useCloudSyncStore()
      await store.syncNow()
      await store.resolveCloudConfig(true)
      expect(mockInvoke).toHaveBeenCalledWith('apply_config_snapshot', {
        snapshot: { theme: { value: 'dark' } }
      })
      expect(mockPut).toHaveBeenCalledWith('configSyncedOnce', true)
      expect(mockPut).toHaveBeenCalledWith('configLastSyncAt', expect.any(Number))
      expect(store.pendingCloudConfig).toBeNull()
    })

    it('首次同步:拒绝覆盖 → 推送本地覆盖云端', async () => {
      mockGetConfig({ configSyncedOnce: undefined })
      mockConfigInvoke({
        pulled: { updatedAt: 100, config: { theme: { value: 'dark' } } },
        local: { theme: { value: 'light' } }
      })
      const store = useCloudSyncStore()
      await store.syncNow()
      await store.resolveCloudConfig(false)
      expect(mockInvoke).not.toHaveBeenCalledWith('apply_config_snapshot', expect.anything())
      expect(mockInvoke).toHaveBeenCalledWith('cloud_push_config', { puuid: 'me' })
      expect(mockPut).toHaveBeenCalledWith('configSyncedOnce', true)
    })

    it('首次同步:云端为空 → 静默推送播种,不弹窗', async () => {
      mockGetConfig({ configSyncedOnce: undefined })
      mockConfigInvoke({ pulled: null, local: { theme: { value: 'light' } } })
      const store = useCloudSyncStore()
      await store.syncNow()
      expect(store.pendingCloudConfig).toBeNull()
      expect(mockInvoke).toHaveBeenCalledWith('cloud_push_config', { puuid: 'me' })
      expect(mockPut).toHaveBeenCalledWith('configSyncedOnce', true)
    })

    it('首次同步:云端与本地一致 → 不弹窗不推送,只落标记', async () => {
      mockGetConfig({ configSyncedOnce: undefined })
      const same = { theme: { value: 'dark' } }
      mockConfigInvoke({ pulled: { updatedAt: 100, config: same }, local: same })
      const store = useCloudSyncStore()
      await store.syncNow()
      expect(store.pendingCloudConfig).toBeNull()
      expect(mockInvoke).not.toHaveBeenCalledWith('cloud_push_config', expect.anything())
      expect(mockPut).toHaveBeenCalledWith('configSyncedOnce', true)
    })

    it('后续同步:云端更新且无本地未推变更 → 静默应用', async () => {
      mockGetConfig({ configSyncedOnce: true, configLastSyncAt: 50 })
      mockConfigInvoke({
        pulled: { updatedAt: 100, config: { theme: { value: 'dark' } } },
        local: { theme: { value: 'light' } }
      })
      const store = useCloudSyncStore()
      await store.syncNow()
      expect(mockInvoke).toHaveBeenCalledWith('apply_config_snapshot', {
        snapshot: { theme: { value: 'dark' } }
      })
      expect(store.pendingCloudConfig).toBeNull()
    })

    it('后续同步:本地有未推送变更 → 推送胜过云端(后写胜)', async () => {
      mockGetConfig({ configSyncedOnce: true, configLastSyncAt: 50 })
      mockConfigInvoke({
        pulled: { updatedAt: 100, config: { theme: { value: 'dark' } } },
        local: { theme: { value: 'light' } }
      })
      const store = useCloudSyncStore()
      store.markConfigDirty() // 模拟 config-changed 事件的效果
      await store.syncNow()
      expect(mockInvoke).not.toHaveBeenCalledWith('apply_config_snapshot', expect.anything())
      expect(mockInvoke).toHaveBeenCalledWith('cloud_push_config', { puuid: 'me' })
    })

    it('后续同步:内容一致 → 不 apply 不 push', async () => {
      mockGetConfig({ configSyncedOnce: true, configLastSyncAt: 50 })
      const same = { theme: { value: 'dark' } }
      mockConfigInvoke({ pulled: { updatedAt: 100, config: same }, local: same })
      const store = useCloudSyncStore()
      await store.syncNow()
      expect(mockInvoke).not.toHaveBeenCalledWith('apply_config_snapshot', expect.anything())
      expect(mockInvoke).not.toHaveBeenCalledWith('cloud_push_config', expect.anything())
    })

    it('弹窗未决期间再次 syncNow:不重复评估、不覆盖 pending、不 apply/push 配置', async () => {
      mockGetConfig({ configSyncedOnce: undefined })
      mockConfigInvoke({
        pulled: { updatedAt: 100, config: { theme: { value: 'dark' } } },
        local: { theme: { value: 'light' } }
      })
      const store = useCloudSyncStore()
      await store.syncNow()
      const pendingRef = store.pendingCloudConfig
      mockInvoke.mockClear()
      await store.syncNow()
      expect(store.pendingCloudConfig).toBe(pendingRef)
      expect(mockInvoke).not.toHaveBeenCalledWith('cloud_pull_config', expect.anything())
      expect(mockInvoke).not.toHaveBeenCalledWith('apply_config_snapshot', expect.anything())
      expect(mockInvoke).not.toHaveBeenCalledWith('cloud_push_config', expect.anything())
    })
  })
})
