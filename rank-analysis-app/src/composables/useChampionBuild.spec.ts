import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, reactive } from 'vue'
import { withSetup } from '@renderer/test-utils/withSetup'
import { useChampionBuild, type BuildQuery } from './useChampionBuild'
import { bumpOpggRevision } from '@renderer/services/opgg'
import type { ChampionBuild, RuneBuild } from '@renderer/types/championBuild'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

/** 按事件名收集回调，供测试手动派发后端事件 */
const eventHandlers: Record<string, (e: { payload: unknown }) => void> = {}
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    eventHandlers[name] = cb
    return () => delete eventHandlers[name]
  })
}))

const PERKS = [8008, 9101, 9104, 8299, 8444, 8451, 5005, 5008, 5001]

function rune(play: number): RuneBuild {
  return {
    primary_style_id: 8000,
    sub_style_id: 8400,
    primary_perk_ids: [8008, 9101, 9104, 8299],
    sub_perk_ids: [8444, 8451],
    stat_mod_ids: [5005, 5008, 5001],
    play,
    win: Math.round(play / 2),
    pick_rate: 0.3
  }
}

function build(championId: number, runePlay = 1000): ChampionBuild {
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
    runes: [rune(runePlay)],
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

  it('手动应用：把推荐那套符文交给后端，成功后标已应用', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'apply_rune_page' ? { ok: true, page_id: 42, reason: null } : undefined
    )

    const pending = r.apply()
    expect(r.applyState.value).toBe('applying')
    await pending

    const call = invokeMock.mock.calls.find(c => c[0] === 'apply_rune_page')
    expect(call?.[1]).toEqual({ championId: 157, position: 'middle', rune: rune(1000) })
    expect(r.applyState.value).toBe('applied')
    app.unmount()
  })

  it('应用失败时保留原因供提示', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    invokeMock.mockResolvedValue({ ok: false, page_id: null, reason: 'page_limit_full' })

    await r.apply()

    expect(r.applyState.value).toBe('failed')
    expect(r.applyReason.value).toBe('page_limit_full')
    app.unmount()
  })

  it('样本不足时不写入', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: { championId: number }) =>
      cmd === 'get_champion_build' ? build(args.championId, 120) : undefined
    )
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    await r.apply()

    expect(invokeMock.mock.calls.some(c => c[0] === 'apply_rune_page')).toBe(false)
    expect(r.applyState.value).toBe('idle')
    app.unmount()
  })

  it('换人后应用状态复位，旧英雄的写入结果不串到新英雄', async () => {
    let release: (v: unknown) => void = () => {}
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    invokeMock.mockImplementation((cmd: string, args: { championId: number }) =>
      cmd === 'apply_rune_page'
        ? new Promise(res => (release = res))
        : Promise.resolve(build(args.championId))
    )

    const pending = r.apply()
    s.championId = 86
    await flush()
    release({ ok: true, page_id: 1, reason: null })
    await pending
    await flush()

    expect(r.applyState.value).toBe('idle')
    app.unmount()
  })

  it('挂载时从后端恢复本次选人期的写入记录（切页回来仍显示已应用）', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: { championId: number }) => {
      if (cmd === 'get_champion_build') return build(args.championId)
      if (cmd === 'get_last_applied_rune') {
        return {
          champion_id: 157,
          position: 'middle',
          primary_style_id: 8000,
          sub_style_id: 8400,
          perk_ids: PERKS
        }
      }
    })
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(r.applyState.value).toBe('applied')
    app.unmount()
  })

  it('写入记录属于别的英雄时不算已应用', async () => {
    invokeMock.mockImplementation(async (cmd: string, args: { championId: number }) => {
      if (cmd === 'get_champion_build') return build(args.championId)
      if (cmd === 'get_last_applied_rune') {
        return {
          champion_id: 86,
          position: 'top',
          primary_style_id: 8000,
          sub_style_id: 8400,
          perk_ids: PERKS
        }
      }
    })
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(r.applyState.value).toBe('idle')
    app.unmount()
  })

  it('自动应用事件：当前推荐内容成功 → 已应用，失败 → 带原因的失败', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    const emit = (payload: unknown) => eventHandlers['rune-apply-result']?.({ payload })

    emit({ champion_id: 86, perk_ids: PERKS, ok: true, reason: null })
    expect(r.applyState.value).toBe('idle') // 别的英雄的结果不认

    emit({ champion_id: 157, perk_ids: PERKS, ok: false, reason: 'lcu_rejected' })
    expect(r.applyState.value).toBe('failed')
    expect(r.applyReason.value).toBe('lcu_rejected')

    emit({ champion_id: 157, perk_ids: PERKS, ok: true, reason: null })
    expect(r.applyState.value).toBe('applied')
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
