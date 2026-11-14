/**
 * 赛后战报状态：只对排位生效、结算端点未就绪时重试、同局不重复加载、进选人清空、按 gameId 取本局 LP。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { __resetPostGameReport, POLL_INTERVAL_MS, usePostGameReport } from './usePostGameReport'

const calls = vi.hoisted(() => ({ ended: 0, game: 0, endedFailFirst: 0 }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: { gameId: number }) => {
    if (cmd === 'get_ended_game') {
      calls.ended++
      if (calls.ended <= calls.endedFailFirst) throw new Error('eog not ready')
      return { gameId: 777, queueType: 'RANKED_SOLO_5x5' }
    }
    if (cmd === 'get_game_by_id') {
      calls.game++
      return { gameId: args!.gameId, queueId: 420, platformId: 'TJ100', gameDuration: 1800 }
    }
    throw new Error(`unexpected ${cmd}`)
  })
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('@renderer/services/hiddenMmr', () => ({
  HIDDEN_MMR_UPDATED_EVENT: 'hidden-mmr-updated',
  getHiddenMmr: async () => ({
    status: 'ready',
    recent: [
      { gameId: 777, delta: 21, source: 'notification', doubled: false },
      { gameId: 1, delta: -20, source: 'notification', doubled: false }
    ]
  })
}))

const phase = ref('InProgress')
const queue = ref(420)

function setup() {
  return usePostGameReport(
    () => phase.value,
    () => queue.value,
    () => 'me'
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetPostGameReport()
  calls.ended = 0
  calls.game = 0
  calls.endedFailFirst = 0
  phase.value = 'InProgress'
  queue.value = 420
})
afterEach(() => {
  vi.useRealTimers()
})

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await nextTick()
  }
}

describe('usePostGameReport', () => {
  it('排位结束：取到对局与本局 LP', async () => {
    const r = setup()
    phase.value = 'EndOfGame'
    await settle()
    expect(r.report.value?.game.gameId).toBe(777)
    expect(r.report.value?.lpDelta).toBe(21)
    expect(r.loading.value).toBe(false)
  })

  it('结算端点没就绪时按间隔重试', async () => {
    calls.endedFailFirst = 2
    const r = setup()
    phase.value = 'PreEndOfGame'
    await settle()
    expect(calls.ended).toBe(3)
    expect(r.report.value?.game.gameId).toBe(777)
  })

  it('PreEndOfGame → EndOfGame 不重复加载同一局', async () => {
    setup()
    phase.value = 'PreEndOfGame'
    await settle()
    phase.value = 'EndOfGame'
    await settle()
    expect(calls.game).toBe(1)
  })

  it('非排位不出战报', async () => {
    queue.value = 450
    const r = setup()
    phase.value = 'EndOfGame'
    await settle()
    expect(calls.ended).toBe(0)
    expect(r.report.value).toBeNull()
  })

  it('回到大厅保留，下一局进选人清空；跳过只影响本局', async () => {
    const r = setup()
    phase.value = 'EndOfGame'
    await settle()
    phase.value = ''
    await nextTick()
    expect(r.report.value).not.toBeNull()
    r.dismiss()
    expect(r.dismissed.value).toBe(true)
    phase.value = 'ChampSelect'
    await nextTick()
    expect(r.report.value).toBeNull()
    expect(r.dismissed.value).toBe(false)
  })
})
