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

  describe('removeNote（墓碑）', () => {
    it('删除写墓碑而非物理删除：getNote/count/list 不可见，底层 map 留 deleted 条目', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', { note: 'x', label: 'careful', gameName: 'G', tagLine: 'T' })
      mockPut.mockClear()

      await store.removeNote('p')

      // 对消费者透明：读不到、数不到、列不出
      expect(store.getNote('p')).toBeUndefined()
      expect(store.count).toBe(0)
      expect(store.list.length).toBe(0)
      // 底层 map 保留墓碑（同步时随合并传播删除），内容字段已清空
      const tomb = store.notes['p']
      expect(tomb?.deleted).toBe(true)
      expect(tomb?.note).toBe('')
      expect(tomb?.encounters).toBeUndefined()
      // 墓碑随整表落盘
      expect(mockPut).toHaveBeenCalledWith(
        'playerNotes',
        expect.objectContaining({ p: expect.objectContaining({ deleted: true }) })
      )
    })

    it('删除不存在的 puuid 不报错、不写墓碑', async () => {
      const store = usePlayerNotesStore()
      mockPut.mockClear()
      await expect(store.removeNote('ghost')).resolves.not.toThrow()
      expect(store.notes['ghost']).toBeUndefined()
      expect(mockPut).not.toHaveBeenCalled()
    })

    it('墓碑传播：并入更旧的活备注时墓碑赢（kept），删除不被复活', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', { note: 'x', label: 'normal', gameName: 'G', tagLine: 'T' })
      await store.removeNote('p')
      const tombTs = store.notes['p'].updatedAt

      // 模拟云端另一设备残留的旧活备注（updatedAt < 墓碑）
      const stats = await store.importNotes({
        p: { note: 'stale', label: 'careful', gameName: 'G', tagLine: 'T', updatedAt: tombTs - 1 }
      })

      expect(stats.kept).toBe(1)
      expect(stats.added + stats.replaced).toBe(0)
      expect(store.getNote('p')).toBeUndefined()
      expect(store.notes['p'].deleted).toBe(true)
    })

    it('删除后重新标记：setNote 覆盖墓碑，getNote 恢复返回', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p', { note: 'x', label: 'normal', gameName: 'G', tagLine: 'T' })
      await store.removeNote('p')

      await store.setNote('p', { note: '回归', label: 'friendly', gameName: 'G', tagLine: 'T' })

      expect(store.getNote('p')?.note).toBe('回归')
      expect(store.notes['p'].deleted).toBeUndefined()
      expect(store.count).toBe(1)
    })
  })

  describe('墓碑 GC（loadFromConfig）', () => {
    it('载入时清理超过 30 天的旧墓碑，保留新墓碑与活备注', async () => {
      const now = Date.now()
      const DAY = 24 * 60 * 60 * 1000
      mockGet.mockResolvedValue({
        oldTomb: {
          note: '',
          label: 'normal',
          gameName: 'O',
          tagLine: '1',
          updatedAt: now - 31 * DAY,
          deleted: true
        },
        freshTomb: {
          note: '',
          label: 'normal',
          gameName: 'F',
          tagLine: '2',
          updatedAt: now - 1 * DAY,
          deleted: true
        },
        live: {
          note: '很老但没删',
          label: 'careful',
          gameName: 'L',
          tagLine: '3',
          updatedAt: now - 100 * DAY
        }
      })
      const store = usePlayerNotesStore()
      await store.init()

      expect(store.notes['oldTomb']).toBeUndefined()
      expect(store.notes['freshTomb']?.deleted).toBe(true)
      // 活备注不受 TTL 影响，再老也保留
      expect(store.getNote('live')?.note).toBe('很老但没删')
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

  describe('健壮性（review 修复）', () => {
    it('reload 后单调时钟不回退：新保存的 updatedAt 大于已载入的最大值（C1）', async () => {
      const big = 9_000_000_000_000_000
      mockGet.mockResolvedValue({
        old: { note: 'x', label: 'normal', gameName: 'O', tagLine: '1', updatedAt: big }
      })
      const store = usePlayerNotesStore()
      await store.init()
      await store.setNote('new', { note: 'y', label: 'normal', gameName: 'N', tagLine: '2' })

      expect(store.getNote('new')!.updatedAt).toBeGreaterThan(big)
      // 列表"最近优先"：new 排在 old 之前
      expect(store.list[0].puuid).toBe('new')
    })

    it('落盘失败时 setNote 抛出而非静默成功（C2）', async () => {
      const store = usePlayerNotesStore()
      mockPut.mockRejectedValueOnce(new Error('disk full'))

      await expect(
        store.setNote('p', { note: 'x', label: 'normal', gameName: 'G', tagLine: 'T' })
      ).rejects.toThrow()
    })
  })

  describe('importNotes', () => {
    it('合并传入表并落盘,返回统计', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p1', { note: 'local', label: 'normal', gameName: 'A', tagLine: '1' })
      const localTs = store.getNote('p1')!.updatedAt
      mockPut.mockClear() // 排除 setNote 自身的落盘，确保断言命中的是 importNotes 的 persist

      const stats = await store.importNotes({
        p1: {
          note: 'stale',
          label: 'careful',
          gameName: 'A',
          tagLine: '1',
          updatedAt: localTs - 1
        },
        p2: { note: 'new', label: 'friendly', gameName: 'B', tagLine: '2', updatedAt: 123 }
      })

      expect(stats).toEqual({ added: 1, replaced: 0, kept: 1, invalid: 0, expired: 0 })
      expect(store.getNote('p1')!.note).toBe('local') // 本地更新,未被覆盖
      expect(store.getNote('p2')!.note).toBe('new')
      // 正向落盘断言：合并结果（含新增的 p2）确实写盘了
      expect(mockPut).toHaveBeenCalledWith(
        'playerNotes',
        expect.objectContaining({ p2: expect.any(Object) })
      )
    })

    it('无实际变化时不落盘', async () => {
      const store = usePlayerNotesStore()
      mockPut.mockClear()
      const stats = await store.importNotes({})
      expect(stats.added + stats.replaced).toBe(0)
      expect(mockPut).not.toHaveBeenCalled()
    })

    it('导入后 lastTs 不回退:再 setNote 的时间戳大于导入的最大 updatedAt', async () => {
      const store = usePlayerNotesStore()
      const future = Date.now() + 60_000
      await store.importNotes({
        p9: { note: 'x', label: 'normal', gameName: 'C', tagLine: '3', updatedAt: future }
      })
      await store.setNote('p10', { note: 'y', label: 'normal', gameName: 'D', tagLine: '4' })
      expect(store.getNote('p10')!.updatedAt).toBeGreaterThan(future)
    })
  })

  describe('userMutationSeq（云同步防抖的调度信号）', () => {
    it('setNote / removeNote 递增', async () => {
      const store = usePlayerNotesStore()
      const before = store.userMutationSeq
      await store.setNote('p1', { note: 'x', label: 'normal', gameName: 'A', tagLine: '1' })
      expect(store.userMutationSeq).toBe(before + 1)
      await store.removeNote('p1')
      expect(store.userMutationSeq).toBe(before + 2)
    })

    it('用户来源 importNotes 有实际变化时递增', async () => {
      const store = usePlayerNotesStore()
      const before = store.userMutationSeq
      await store.importNotes({
        p2: { note: 'n', label: 'normal', gameName: 'B', tagLine: '2', updatedAt: 1 }
      })
      expect(store.userMutationSeq).toBe(before + 1)
    })

    it('sync 来源 importNotes 不递增（同步合并不得自触发下一轮推送）', async () => {
      const store = usePlayerNotesStore()
      const before = store.userMutationSeq
      await store.importNotes(
        { p3: { note: 'r', label: 'normal', gameName: 'C', tagLine: '3', updatedAt: 1 } },
        'sync'
      )
      expect(store.userMutationSeq).toBe(before)
    })

    it('无实际变化的 importNotes 不递增', async () => {
      const store = usePlayerNotesStore()
      const before = store.userMutationSeq
      await store.importNotes({})
      expect(store.userMutationSeq).toBe(before)
    })
  })
})
