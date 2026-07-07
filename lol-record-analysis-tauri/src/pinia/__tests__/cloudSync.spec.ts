/**
 * useCloudSyncStore 单元测试
 * @module pinia/cloudSync
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import { useCloudSyncStore } from '../cloudSync'
import { usePlayerNotesStore } from '../playerNotes'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)

describe('useCloudSyncStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
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
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'cloud_pull_notes') return []
      return undefined
    })
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
})
