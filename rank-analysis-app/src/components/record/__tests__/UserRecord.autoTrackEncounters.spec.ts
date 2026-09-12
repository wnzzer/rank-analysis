/**
 * UserRecord.vue · 备注遇见记录被动追踪接线测试
 *
 * 只验证新增的这段接线本身：查询对象是「我自己」时调用 autoTrackEncounters，
 * 查询别人时不调用。autoTrackEncounters 自身的正确性已在
 * utils/__tests__/autoTrackEncounters.spec.ts 覆盖，这里用 vi.mock 换成 spy，
 * 避免为了测一行 if 去搭一整套真实的 notesStore + 同场数据。
 *
 * @module components/record/UserRecord
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(() => Promise.resolve(0)),
  putConfigByIpc: vi.fn(() => Promise.resolve()),
  // 组件 onMounted 会调 initModeOptions() → getGameModesByIpc()；brief 原始 mock
  // 未含此导出，实测会在 initModeOptions 里被 catch 但仍打一条 console.error 噪音，
  // 与本测试无关，这里补上避免污染输出。
  getGameModesByIpc: vi.fn(() => Promise.resolve([]))
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

const mySummoner = ref<{ puuid: string } | null>({ puuid: 'my-puuid' })
vi.mock('@renderer/composables/useGameState', () => ({
  useGameState: () => ({ summoner: mySummoner })
}))

const autoTrackEncountersMock = vi.fn()
vi.mock('@renderer/utils/autoTrackEncounters', () => ({
  autoTrackEncounters: (...args: unknown[]) => autoTrackEncountersMock(...args)
}))

const oneGamePlayersMap = { other: [{ gameId: 1 }] }
function mockInvokeFor(queriedPuuid: string) {
  return vi.fn(async (cmd: string) => {
    switch (cmd) {
      case 'get_summoner_by_name':
        return { puuid: queriedPuuid, gameName: 'Queried', tagLine: 'NA1' }
      case 'get_rank_by_name':
        return { queueMap: {} }
      case 'get_platform_name_by_name':
        return '联盟一区'
      case 'get_win_rate_by_name_mode':
        return { wins: 0, losses: 0 }
      case 'get_user_tag_by_name':
        return { tag: [], recentData: { oneGamePlayersMap } }
      default:
        return undefined
    }
  })
}

vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => ({ success: vi.fn(), error: vi.fn() }) }
})

vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRoute: () => ({ query: { name: 'Queried#NA1' } }) }
})

const stubs = {
  RelationshipPanel: true,
  RankCard: true,
  RecentStatsTable: true,
  PlayerNoteBadge: true,
  UnifiedTagRow: true
}

describe('UserRecord.vue 被动追踪接线', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    autoTrackEncountersMock.mockClear()
    mySummoner.value = { puuid: 'my-puuid' }
  })

  it('查询对象是我自己时，调用 autoTrackEncounters', async () => {
    const invoke = mockInvokeFor('my-puuid')
    vi.resetModules()
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const UserRecord = (await import('../UserRecord.vue')).default

    const w = mount(UserRecord, { global: { plugins: [naive], stubs } })
    await vi.waitFor(() => expect(autoTrackEncountersMock).toHaveBeenCalledTimes(1))
    expect(autoTrackEncountersMock).toHaveBeenCalledWith(
      oneGamePlayersMap,
      expect.any(Function),
      expect.any(Function)
    )
    w.unmount()
  })

  it('查询别人时，不调用 autoTrackEncounters', async () => {
    const invoke = mockInvokeFor('someone-else-puuid')
    vi.resetModules()
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const UserRecord = (await import('../UserRecord.vue')).default

    const w = mount(UserRecord, { global: { plugins: [naive], stubs } })
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('get_user_tag_by_name', expect.anything())
    )
    expect(autoTrackEncountersMock).not.toHaveBeenCalled()
    w.unmount()
  })
})
