import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, reactive } from 'vue'
import { withSetup } from '@renderer/test-utils/withSetup'
import { useChampionBuild, type BuildQuery } from './useChampionBuild'
import { bumpOpggRevision } from '@renderer/services/opgg'
import type { ChampionBuild } from '@renderer/types/championBuild'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

function build(championId: number): ChampionBuild {
  return {
    schema_version: 1,
    champion_id: championId,
    position: 'middle',
    mode: 'ranked',
    tier: 'emerald_plus',
    patch: '16.18',
    fetched_at: 0,
    play: 1000,
    win_rate: 0.5,
    runes: [],
    spells: [],
    starter_items: [],
    boots: [],
    core_items: [],
    last_items: [],
    skills: [],
    stale: false
  }
}

/** 让 watch 回调与 await 链落定 */
async function flush() {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
}

/** 只统计取数命令的调用（排除其他 invoke） */
const buildCalls = () => invokeMock.mock.calls.filter(c => c[0] === 'get_champion_build')

/** 模拟会话：key 字段之外还有「战绩渐进到达」这类无关字段在变 */
function session(overrides: Partial<BuildQuery> = {}) {
  return reactive({
    active: true,
    gameMode: 'CLASSIC',
    championId: 157,
    position: 'middle' as string | null,
    matchHistoryLength: 0,
    ...overrides
  })
}

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (cmd: string, args: { championId: number }) =>
    cmd === 'get_champion_build' ? build(args.championId) : undefined
  )
})

describe('useChampionBuild', () => {
  it('选人期且有英雄时拉取构筑', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(buildCalls()).toHaveLength(1)
    expect(buildCalls()[0][1]).toEqual({ championId: 157, gameMode: 'CLASSIC', position: 'middle' })
    expect(r.build.value?.champion_id).toBe(157)
    expect(r.loading.value).toBe(false)
    app.unmount()
  })

  it('非选人期或未亮英雄时不拉取', async () => {
    const s = session({ active: false })
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    expect(buildCalls()).toHaveLength(0)

    s.active = true
    s.championId = 0
    await flush()
    expect(buildCalls()).toHaveLength(0)
    expect(r.build.value).toBeNull()
    app.unmount()
  })

  it('换人（championId 变化）触发重拉', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    s.championId = 86
    await flush()

    expect(buildCalls()).toHaveLength(2)
    expect(r.build.value?.champion_id).toBe(86)
    app.unmount()
  })

  it('无关字段变化（战绩渐进到达）不重拉', async () => {
    const s = session()
    const [, app] = withSetup(() =>
      useChampionBuild(() => ({ ...s, matchHistoryLength: s.matchHistoryLength }))
    )
    await flush()

    s.matchHistoryLength = 20
    await flush()

    expect(buildCalls()).toHaveLength(1)
    app.unmount()
  })

  it('大乱斗无分路时 position 传 null，由后端按 gameMode 判定', async () => {
    const s = session({ gameMode: 'ARAM', position: null })
    const [, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(buildCalls()[0][1]).toEqual({ championId: 157, gameMode: 'ARAM', position: null })
    app.unmount()
  })

  it('快速换人时丢弃过期响应', async () => {
    let releaseFirst: (b: ChampionBuild) => void = () => {}
    invokeMock.mockImplementation((cmd: string, args: { championId: number }) => {
      if (cmd !== 'get_champion_build') return Promise.resolve(undefined)
      if (args.championId === 157) return new Promise(res => (releaseFirst = res))
      return Promise.resolve(build(args.championId))
    })
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    s.championId = 86
    await flush()
    releaseFirst(build(157)) // 旧请求晚到
    await flush()

    expect(r.build.value?.champion_id).toBe(86)
    app.unmount()
  })

  it('拉取中清掉旧英雄的数据并标 loading', async () => {
    let release: (b: ChampionBuild) => void = () => {}
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    invokeMock.mockImplementation(() => new Promise(res => (release = res)))

    s.championId = 86
    await flush()

    expect(r.loading.value).toBe(true)
    expect(r.build.value).toBeNull()
    release(build(86))
    await flush()
    expect(r.loading.value).toBe(false)
    app.unmount()
  })

  it('段位切换（opggRevision 变化）触发重拉', async () => {
    const s = session()
    const [, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    bumpOpggRevision()
    await flush()

    expect(buildCalls()).toHaveLength(2)
    app.unmount()
  })
})
