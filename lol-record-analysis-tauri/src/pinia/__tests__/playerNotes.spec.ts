/**
 * usePlayerNotesStore 单元测试
 * @module pinia/playerNotes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock config IPC，避免触达 Tauri runtime
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn(() => Promise.resolve())
}))

// Mock Tauri 事件（跨窗口同步用），jsdom 下无 Tauri runtime
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { usePlayerNotesStore } from '../playerNotes'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)

describe('usePlayerNotesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockPut.mockResolvedValue(undefined)
  })

  describe('init', () => {
    it('从 config 载入已有备注', async () => {
      mockGet.mockResolvedValue({
        'puuid-1': { note: '坑', label: 'careful', gameName: 'A', tagLine: '1', updatedAt: 1 }
      })
      const store = usePlayerNotesStore()
      await store.init()

      expect(store.getNote('puuid-1')?.label).toBe('careful')
    })

    it('config 为空时安全降级为空表', async () => {
      mockGet.mockResolvedValue(undefined)
      const store = usePlayerNotesStore()
      await store.init()

      expect(store.getNote('whatever')).toBeUndefined()
      expect(store.count).toBe(0)
    })

    it('getConfigByIpc 抛错时不崩，保持空表', async () => {
      mockGet.mockRejectedValue(new Error('ipc down'))
      const store = usePlayerNotesStore()
      await store.init()

      expect(store.count).toBe(0)
    })
  })

  describe('setNote', () => {
    it('写入内存并整体落盘', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('puuid-2', {
        note: '一起上分',
        label: 'friendly',
        gameName: 'Hide on bush',
        tagLine: 'KR1'
      })

      const saved = store.getNote('puuid-2')
      expect(saved?.note).toBe('一起上分')
      expect(saved?.label).toBe('friendly')
      expect(saved?.gameName).toBe('Hide on bush')
      expect(saved?.updatedAt).toBeGreaterThan(0)

      // 落盘：put 收到的是整张表
      expect(mockPut).toHaveBeenCalledWith(
        'playerNotes',
        expect.objectContaining({ 'puuid-2': expect.any(Object) })
      )
    })

    it('对同一 puuid 再次写入会覆盖', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', { note: 'a', label: 'normal', gameName: 'G', tagLine: 'T' })
      await store.setNote('p', { note: 'b', label: 'blacklist', gameName: 'G', tagLine: 'T' })

      expect(store.getNote('p')?.note).toBe('b')
      expect(store.getNote('p')?.label).toBe('blacklist')
      expect(store.count).toBe(1)
    })
  })

  describe('removeNote', () => {
    it('删除内存条目并落盘', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', { note: 'x', label: 'normal', gameName: 'G', tagLine: 'T' })
      mockPut.mockClear()

      await store.removeNote('p')

      expect(store.getNote('p')).toBeUndefined()
      expect(mockPut).toHaveBeenCalledWith(
        'playerNotes',
        expect.not.objectContaining({ p: expect.anything() })
      )
    })

    it('删除不存在的 puuid 不报错', async () => {
      const store = usePlayerNotesStore()
      await expect(store.removeNote('ghost')).resolves.not.toThrow()
    })
  })

  describe('list', () => {
    it('返回按 updatedAt 倒序的 [puuid, note] 列表', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('old', { note: '1', label: 'normal', gameName: 'O', tagLine: 'T' })
      await store.setNote('new', { note: '2', label: 'normal', gameName: 'N', tagLine: 'T' })

      const list = store.list
      expect(list.length).toBe(2)
      // new 的 updatedAt >= old，排前面
      expect(list[0].puuid).toBe('new')
    })
  })

  describe('encounters（遇见记录）', () => {
    const makeEncounter = (gameId: number, gameCreatedAt: string) => ({
      gameCreatedAt,
      index: 0,
      gameId,
      puuid: 'p',
      gameName: 'G',
      tagLine: 'T',
      championId: 1,
      win: true,
      kills: 1,
      deaths: 2,
      assists: 3,
      isMyTeam: false,
      queueIdCn: '极地大乱斗'
    })

    it('保存时带 encounter 会记入遇见列表', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', {
        note: '',
        label: 'careful',
        gameName: 'G',
        tagLine: 'T',
        encounter: makeEncounter(1001, '2026-05-20T10:00:00Z')
      })
      expect(store.getNote('p')?.encounters?.length).toBe(1)
      expect(store.getNote('p')?.encounters?.[0].gameId).toBe(1001)
    })

    it('多局累积、按 gameId 去重、最近在前', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', {
        note: '',
        label: 'careful',
        gameName: 'G',
        tagLine: 'T',
        encounter: makeEncounter(1, '2026-05-20T10:00:00Z')
      })
      await store.setNote('p', {
        note: '',
        label: 'careful',
        gameName: 'G',
        tagLine: 'T',
        encounter: makeEncounter(2, '2026-05-22T10:00:00Z')
      })
      // 重复 gameId=1 不应新增，且较旧
      await store.setNote('p', {
        note: '',
        label: 'careful',
        gameName: 'G',
        tagLine: 'T',
        encounter: makeEncounter(1, '2026-05-20T10:00:00Z')
      })

      const enc = store.getNote('p')?.encounters
      expect(enc?.length).toBe(2)
      expect(enc?.[0].gameId).toBe(2) // 最近在前
    })

    it('不传 encounter 时保留已有遇见记录', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', {
        note: 'a',
        label: 'careful',
        gameName: 'G',
        tagLine: 'T',
        encounter: makeEncounter(1, '2026-05-20T10:00:00Z')
      })
      await store.setNote('p', { note: 'b', label: 'blacklist', gameName: 'G', tagLine: 'T' })

      expect(store.getNote('p')?.note).toBe('b')
      expect(store.getNote('p')?.encounters?.length).toBe(1)
    })
  })
})
