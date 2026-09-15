import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, reactive } from 'vue'
import { withSetup } from '@renderer/test-utils/withSetup'
import { useChampionBuild, type BuildQuery } from './useChampionBuild'
import { bumpOpggRevision } from '@renderer/services/opgg'
import type { ChampionBuild, RuneBuild, RunePreset } from '@renderer/types/championBuild'

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

function rune(play: number, keystone = 8008): RuneBuild {
  return {
    primary_style_id: 8000,
    sub_style_id: 8400,
    primary_perk_ids: [keystone, 9101, 9104, 8299],
    sub_perk_ids: [8444, 8451],
    stat_mod_ids: [5005, 5008, 5001],
    play,
    win: Math.round(play / 2),
    pick_rate: 0.3
  }
}

const perks = (keystone: number) => [keystone, 9101, 9104, 8299, 8444, 8451, 5005, 5008, 5001]

function build(championId: number, runes: RuneBuild[] = [rune(1000)]): ChampionBuild {
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
    runes,
    spells: [],
    starter_items: [],
    boots: [],
    core_items: [],
    last_items: [],
    skills: [],
    stale: false
  }
}

function preset(championId: number, position: string, keystone: number): RunePreset {
  const r = rune(0, keystone)
  return {
    champion_id: championId,
    position,
    primary_style_id: r.primary_style_id,
    sub_style_id: r.sub_style_id,
    primary_perk_ids: r.primary_perk_ids,
    sub_perk_ids: r.sub_perk_ids,
    stat_mod_ids: r.stat_mod_ids,
    saved_at: 1,
    source: 'opgg'
  }
}

/** 让 watch 回调与 await 链落定 */
async function flush() {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
}

/** 模拟后端：构筑、写入、写入记录、配置 */
let buildFor: (championId: number) => ChampionBuild | null
let config: Record<string, unknown>
let lastApplied: unknown

function installBackend() {
  invokeMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case 'get_champion_build':
        return buildFor(args.championId as number)
      case 'get_last_applied_rune':
        return lastApplied
      case 'get_config': {
        const k = args.key as string
        return k in config ? { value: config[k] } : null
      }
      case 'put_config':
        config[args.key as string] = (args.value as { value: unknown }).value
        return null
      case 'apply_rune_page':
        return { ok: true, page_id: 42, reason: null }
      default:
        return undefined
    }
  })
}

/** 只统计某个命令的调用 */
const calls = (cmd: string) => invokeMock.mock.calls.filter(c => c[0] === cmd)

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
  for (const k of Object.keys(eventHandlers)) delete eventHandlers[k]
  buildFor = id => build(id)
  config = {}
  lastApplied = null
  installBackend()
})

describe('useChampionBuild 取数', () => {
  it('选人期且有英雄时拉取构筑', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(calls('get_champion_build')).toHaveLength(1)
    expect(calls('get_champion_build')[0][1]).toEqual({
      championId: 157,
      gameMode: 'CLASSIC',
      position: 'middle'
    })
    expect(r.build.value?.champion_id).toBe(157)
    expect(r.loading.value).toBe(false)
    app.unmount()
  })

  it('非选人期或未亮英雄时不拉取', async () => {
    const s = session({ active: false })
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    expect(calls('get_champion_build')).toHaveLength(0)

    s.active = true
    s.championId = 0
    await flush()
    expect(calls('get_champion_build')).toHaveLength(0)
    expect(r.build.value).toBeNull()
    app.unmount()
  })

  it('换人（championId 变化）触发重拉', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    s.championId = 86
    await flush()

    expect(calls('get_champion_build')).toHaveLength(2)
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

    expect(calls('get_champion_build')).toHaveLength(1)
    app.unmount()
  })

  it('大乱斗无分路时 position 传 null，由后端按 gameMode 判定', async () => {
    const s = session({ gameMode: 'ARAM', position: null })
    const [, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(calls('get_champion_build')[0][1]).toEqual({
      championId: 157,
      gameMode: 'ARAM',
      position: null
    })
    app.unmount()
  })

  it('快速换人时丢弃过期响应', async () => {
    let releaseFirst: (b: ChampionBuild) => void = () => {}
    const base = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'get_champion_build' && args.championId === 157) {
        return new Promise(res => (releaseFirst = res))
      }
      return base(cmd, args)
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
    const base = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) =>
      cmd === 'get_champion_build' ? new Promise(res => (release = res)) : base(cmd, args)
    )

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

    expect(calls('get_champion_build')).toHaveLength(2)
    app.unmount()
  })
})

describe('useChampionBuild 方案卡与选中', () => {
  it('默认选中第一套样本达标的 OP.GG 构筑', async () => {
    buildFor = id => build(id, [rune(150, 8021), rune(900, 8010)])
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(r.options.value.map(o => o.key)).toEqual(['opgg-0', 'opgg-1'])
    expect(r.selectedKey.value).toBe('opgg-1')
    app.unmount()
  })

  it('有我的方案时默认选中它；不在 OP.GG 里则单独成卡', async () => {
    config['settings.auto.runePresets'] = [preset(157, 'middle', 8229)]
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(r.options.value[0].key).toBe('preset')
    expect(r.selectedKey.value).toBe('preset')
    expect(r.remembered.value).toBe(true)
    app.unmount()
  })

  it('OP.GG 拉不到时仍给出我的方案卡', async () => {
    buildFor = () => null
    config['settings.auto.runePresets'] = [preset(157, 'middle', 8229)]
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(r.build.value).toBeNull()
    expect(r.options.value.map(o => o.key)).toEqual(['preset'])
    app.unmount()
  })

  it('点选切换；换英雄后回到默认选中', async () => {
    buildFor = id => build(id, [rune(900, 8008), rune(900, 8021)])
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    r.select('opgg-1')
    expect(r.selectedKey.value).toBe('opgg-1')

    s.championId = 86
    await flush()
    expect(r.selectedKey.value).toBe('opgg-0')
    app.unmount()
  })

  it('自动目标：有方案写方案，否则按兜底取样本达标的第一套', async () => {
    buildFor = id => build(id, [rune(150, 8021), rune(900, 8010)])
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    expect(r.autoTarget.value).toBe('opgg-1')
    app.unmount()

    config['settings.auto.runeFallback'] = 'none'
    const [r2, app2] = withSetup(() => useChampionBuild(() => s))
    await flush()
    expect(r2.autoTarget.value).toBeNull()
    app2.unmount()

    config['settings.auto.runePresets'] = [preset(157, 'middle', 8021)]
    const [r3, app3] = withSetup(() => useChampionBuild(() => s))
    await flush()
    expect(r3.autoTarget.value).toBe('opgg-0')
    app3.unmount()
  })
})

describe('useChampionBuild 应用与记住', () => {
  it('应用写入选中的那套，成功后标已应用并视为手动接管', async () => {
    buildFor = id => build(id, [rune(900, 8008), rune(900, 8021)])
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    r.select('opgg-1')

    const pending = r.apply()
    expect(r.applyState.value).toBe('applying')
    await pending

    expect(calls('apply_rune_page')[0][1]).toEqual({
      championId: 157,
      position: 'middle',
      rune: rune(900, 8021)
    })
    expect(r.applyState.value).toBe('applied')
    expect(r.overridden.value).toBe(true)
    expect(r.autoTarget.value).toBeNull()
    // 切到另一张卡：那套没写过
    r.select('opgg-0')
    expect(r.applyState.value).toBe('idle')
    app.unmount()
  })

  it('样本少的方案也允许手动应用（用户主动点选即知情）', async () => {
    buildFor = id => build(id, [rune(120, 8008)])
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    await r.apply()

    expect(calls('apply_rune_page')).toHaveLength(1)
    app.unmount()
  })

  it('应用失败时保留原因供提示', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    const base = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) =>
      cmd === 'apply_rune_page'
        ? Promise.resolve({ ok: false, page_id: null, reason: 'page_limit_full' })
        : base(cmd, args)
    )

    await r.apply()

    expect(r.applyState.value).toBe('failed')
    expect(r.applyReason.value).toBe('page_limit_full')
    app.unmount()
  })

  it('换人后应用状态复位，旧英雄的写入结果不串到新英雄', async () => {
    let release: (v: unknown) => void = () => {}
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    const base = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) =>
      cmd === 'apply_rune_page' ? new Promise(res => (release = res)) : base(cmd, args)
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

  it('记住选中的那套（按英雄 + 分路落盘），再点即取消', async () => {
    buildFor = id => build(id, [rune(900, 8008), rune(900, 8021)])
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    r.select('opgg-1')

    expect(await r.toggleRemember()).toBe('remembered')
    const saved = config['settings.auto.runePresets'] as RunePreset[]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ champion_id: 157, position: 'middle' })
    expect(saved[0].primary_perk_ids[0]).toBe(8021)
    expect(r.remembered.value).toBe(true)
    expect(r.selectedKey.value).toBe('opgg-1')

    expect(await r.toggleRemember()).toBe('forgotten')
    expect(config['settings.auto.runePresets']).toEqual([])
    expect(r.remembered.value).toBe(false)
    app.unmount()
  })
})

describe('useChampionBuild 恢复与事件', () => {
  it('挂载时恢复本次选人期的写入记录与手动接管', async () => {
    lastApplied = {
      champion_id: 157,
      position: 'middle',
      primary_style_id: 8000,
      sub_style_id: 8400,
      perk_ids: perks(8008),
      manual_override: true
    }
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(r.applyState.value).toBe('applied')
    expect(r.overridden.value).toBe(true)
    expect(r.autoTarget.value).toBeNull()
    app.unmount()
  })

  it('写入记录属于别的英雄时不算已应用', async () => {
    lastApplied = {
      champion_id: 86,
      position: 'top',
      primary_style_id: 8000,
      sub_style_id: 8400,
      perk_ids: perks(8008),
      manual_override: true
    }
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()

    expect(r.applyState.value).toBe('idle')
    expect(r.overridden.value).toBe(false)
    app.unmount()
  })

  it('自动应用事件：选中那套成功 → 已应用，失败 → 带原因的失败', async () => {
    const s = session()
    const [r, app] = withSetup(() => useChampionBuild(() => s))
    await flush()
    const emit = (payload: unknown) => eventHandlers['rune-apply-result']?.({ payload })

    emit({ champion_id: 86, perk_ids: perks(8008), ok: true, reason: null })
    expect(r.applyState.value).toBe('idle') // 别的英雄的结果不认

    emit({ champion_id: 157, perk_ids: perks(8008), ok: false, reason: 'lcu_rejected' })
    expect(r.applyState.value).toBe('failed')
    expect(r.applyReason.value).toBe('lcu_rejected')

    emit({ champion_id: 157, perk_ids: perks(8008), ok: true, reason: null })
    expect(r.applyState.value).toBe('applied')
    app.unmount()
  })
})
