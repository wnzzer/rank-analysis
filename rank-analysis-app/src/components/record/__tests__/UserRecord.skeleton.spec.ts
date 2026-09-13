/**
 * UserRecord.vue · 骨架屏加载态测试
 *
 * 守护：数据回来前渲染骨架而非默认假值；切换玩家回到骨架；请求失败回落默认渲染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import naive from 'naive-ui'
import RankCard from '../RankCard.vue'
import RecentStatsTable from '../RecentStatsTable.vue'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  route: null as null | { query: Record<string, string> }
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(() => Promise.resolve(0)),
  putConfigByIpc: vi.fn(() => Promise.resolve()),
  getGameModesByIpc: vi.fn(() => Promise.resolve([]))
}))
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))
vi.mock('@renderer/composables/useGameState', async () => {
  const { ref } = await import('vue')
  return { useGameState: () => ({ summoner: ref(null) }) }
})
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => ({ success: vi.fn(), error: vi.fn() }) }
})
vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  const { reactive } = await import('vue')
  h.route = reactive({ query: { name: 'Alpha#1' } })
  return { ...actual, useRoute: () => h.route }
})

// 静态导入（vi.mock 会被提升到其前）：编译耗时计入收集阶段，不占用例超时
import UserRecord from '../UserRecord.vue'

const stubs = {
  RelationshipPanel: true,
  RankCard: true,
  RecentStatsTable: true,
  PlayerNoteBadge: true,
  UnifiedTagRow: true
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

function answer(cmd: string): unknown {
  switch (cmd) {
    case 'get_summoner_by_name':
      return { puuid: 'p1', gameName: 'Alpha', tagLine: '1', profileIconId: 1, summonerLevel: 30 }
    case 'get_rank_by_name':
      return { queueMap: {} }
    case 'get_platform_name_by_name':
      return '联盟一区'
    case 'get_win_rate_by_name_mode':
      return { wins: 1, losses: 1, winRate: 50 }
    case 'get_user_tag_by_name':
      return { tag: [], recentData: {} }
    default:
      return undefined
  }
}

function loadingStates(w: ReturnType<typeof mount>) {
  return {
    identity: w.find('.user-record-identity-sk').exists(),
    rank: w.findAllComponents(RankCard).map(c => c.props('loading')),
    recent: w.findComponent(RecentStatsTable).props('loading')
  }
}

describe('UserRecord.vue 骨架屏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    h.invoke.mockReset()
    if (h.route) h.route.query = { name: 'Alpha#1' }
  })

  it('shows skeletons instead of placeholder zeros until data arrives', async () => {
    const summoner = deferred<unknown>()
    h.invoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_summoner_by_name' ? summoner.promise : answer(cmd)
    )
    const w = mount(UserRecord, { global: { plugins: [naive], stubs } })
    await flushPromises()
    expect(loadingStates(w)).toEqual({ identity: true, rank: [true, true], recent: true })

    summoner.resolve(answer('get_summoner_by_name'))
    await flushPromises()
    expect(loadingStates(w)).toEqual({ identity: false, rank: [false, false], recent: false })
    w.unmount()
  })

  it('returns to skeletons when switching to another player', async () => {
    h.invoke.mockImplementation(async (cmd: string) => answer(cmd))
    const w = mount(UserRecord, { global: { plugins: [naive], stubs } })
    await flushPromises()
    expect(loadingStates(w).identity).toBe(false)

    const next = deferred<unknown>()
    h.invoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_summoner_by_name' ? next.promise : answer(cmd)
    )
    h.route!.query = { name: 'Beta#2' }
    await flushPromises()
    expect(loadingStates(w)).toEqual({ identity: true, rank: [true, true], recent: true })

    next.resolve({ ...(answer('get_summoner_by_name') as object), gameName: 'Beta' })
    await flushPromises()
    expect(loadingStates(w).identity).toBe(false)
    w.unmount()
  })

  it('falls back to default rendering when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_summoner_by_name') throw new Error('lcu down')
      return answer(cmd)
    })
    const w = mount(UserRecord, { global: { plugins: [naive], stubs } })
    await flushPromises()
    expect(loadingStates(w)).toEqual({ identity: false, rank: [false, false], recent: false })
    w.unmount()
  })
})
