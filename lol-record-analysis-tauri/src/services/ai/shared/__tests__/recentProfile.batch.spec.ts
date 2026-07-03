import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Mock @tauri-apps/api/core BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Mock Tauri 事件（playerNotes store 落盘后跨窗口广播用）
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

import { invoke } from '@tauri-apps/api/core'
import { fetchBatchProfiles, __resetCacheForTests } from '../recentProfile.batch'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'

const mockInvoke = invoke as ReturnType<typeof vi.fn>

/** 只统计战绩拉取的 invoke 次数（备注开关的 get_config 调用不计入） */
const historyCallCount = () =>
  mockInvoke.mock.calls.filter(c => c[0] === 'get_match_history_by_puuid').length

beforeEach(() => {
  mockInvoke.mockReset()
  __resetCacheForTests()
  // buildNoteBrief（备注注入）依赖 pinia store
  setActivePinia(createPinia())
})

function rawMatch(opts: { puuid: string; teamPosition: string; championId: number; win: boolean }) {
  return {
    queueId: 420,
    gameId: Math.random(),
    gameDuration: 1500,
    participants: [
      {
        participantId: 1,
        championId: opts.championId,
        teamPosition: opts.teamPosition,
        spell1Id: 4,
        spell2Id: 11,
        stats: { win: opts.win, kills: 5, deaths: 3, assists: 7 }
      }
    ],
    participantIdentities: [{ participantId: 1, player: { puuid: opts.puuid } }]
  }
}

function rawHistory(_puuid: string, games: ReturnType<typeof rawMatch>[]) {
  return { games: { games } }
}

describe('fetchBatchProfiles', () => {
  it('returns a profile per puuid in parallel', async () => {
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_match_history_by_puuid') {
        return rawHistory(args.puuid, [
          rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
        ])
      }
    })

    const result = await fetchBatchProfiles([
      { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 },
      { puuid: 'p2', teamPosition: 'TOP', championId: 86 }
    ])

    expect(result.size).toBe(2)
    expect(result.get('p1')).not.toBeNull()
    expect(result.get('p2')).not.toBeNull()
  })

  it('isolates individual failures', async () => {
    mockInvoke.mockImplementation(async (_cmd, args: any) => {
      if (args.puuid === 'p_bad') throw new Error('LCU offline')
      return rawHistory(args.puuid, [
        rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
      ])
    })

    const result = await fetchBatchProfiles([
      { puuid: 'p_ok', teamPosition: 'JUNGLE', championId: 64 },
      { puuid: 'p_bad', teamPosition: 'TOP', championId: 86 }
    ])

    expect(result.get('p_ok')).not.toBeNull()
    expect(result.get('p_bad')).toBeNull()
  })

  it('hits LRU on second call within TTL', async () => {
    mockInvoke.mockImplementation(async (_cmd, args: any) => {
      return rawHistory(args.puuid, [
        rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
      ])
    })

    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])
    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])

    // First call: 1 history invoke. Second call: cache hit → no additional invoke.
    expect(historyCallCount()).toBe(1)
  })

  it('re-fetches if cache expired (advance fake timers)', async () => {
    vi.useFakeTimers()
    mockInvoke.mockImplementation(async (_cmd, args: any) =>
      rawHistory(args.puuid, [
        rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
      ])
    )

    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])
    vi.advanceTimersByTime(11 * 60 * 1000) // 11 minutes
    await fetchBatchProfiles([{ puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }])

    expect(historyCallCount()).toBe(2)
    vi.useRealTimers()
  })

  describe('手动备注注入', () => {
    /** get_match_history 返回一场对局，get_config 按 aiUsePlayerNotes 返回指定值 */
    function mockLcuWithConfig(useNotesValue: boolean | undefined) {
      mockInvoke.mockImplementation(async (cmd, args: any) => {
        if (cmd === 'get_match_history_by_puuid') {
          return rawHistory(args.puuid, [
            rawMatch({ puuid: args.puuid, teamPosition: 'JUNGLE', championId: 64, win: true })
          ])
        }
        if (cmd === 'get_config') {
          return useNotesValue === undefined ? null : { value: useNotesValue }
        }
        return null
      })
    }

    it('开关默认开（键不存在）时注入 profile.note', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p1', { note: '演员', label: 'blacklist', gameName: 'A', tagLine: '1' })
      mockLcuWithConfig(undefined)

      const result = await fetchBatchProfiles([
        { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 },
        { puuid: 'p2', teamPosition: 'TOP', championId: 86 }
      ])

      expect(result.get('p1')?.note).toBe('[拉黑] 演员')
      // 无备注的玩家不带 note 字段
      expect(result.get('p2')?.note).toBeUndefined()
    })

    it('开关显式关闭时不注入', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p1', { note: '演员', label: 'blacklist', gameName: 'A', tagLine: '1' })
      mockLcuWithConfig(false)

      const result = await fetchBatchProfiles([
        { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }
      ])

      expect(result.get('p1')?.note).toBeUndefined()
    })

    it('note 不写入 LRU 缓存：开关关闭后缓存命中也不带 note', async () => {
      const store = usePlayerNotesStore()
      await store.setNote('p1', { note: '演员', label: 'blacklist', gameName: 'A', tagLine: '1' })

      // 第一次：开关开 → 带 note
      mockLcuWithConfig(undefined)
      const first = await fetchBatchProfiles([
        { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }
      ])
      expect(first.get('p1')?.note).toBe('[拉黑] 演员')

      // 第二次：缓存命中（不再拉战绩），但开关已关 → 不得残留 note
      mockLcuWithConfig(false)
      const second = await fetchBatchProfiles([
        { puuid: 'p1', teamPosition: 'JUNGLE', championId: 64 }
      ])
      expect(historyCallCount()).toBe(1)
      expect(second.get('p1')?.note).toBeUndefined()
    })
  })
})
