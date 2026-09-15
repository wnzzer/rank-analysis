import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  applyRunePage,
  applyFailureText,
  autoTargetKey,
  buildRuneOptions,
  defaultOptionKey,
  fetchChampionBuild,
  presetFromRune,
  presetPositionOf,
  presetToRune
} from '../championBuild'
import type { ChampionBuild, RuneBuild, RunePreset } from '@renderer/types/championBuild'

const mockInvoke = vi.mocked(invoke)

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

function build(runes: RuneBuild[]): ChampionBuild {
  return {
    schema_version: 1,
    champion_id: 157,
    position: 'middle',
    mode: 'ranked',
    tier: 'emerald_plus',
    patch: '16.18',
    fetched_at: 0,
    play: 77441,
    win_rate: 0.49,
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

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('fetchChampionBuild', () => {
  it('透传英雄 / 模式 / 分路给后端命令', async () => {
    const b = build([rune(1000)])
    mockInvoke.mockResolvedValue(b)

    const got = await fetchChampionBuild(157, 'CLASSIC', 'middle')

    expect(mockInvoke).toHaveBeenCalledWith('get_champion_build', {
      championId: 157,
      gameMode: 'CLASSIC',
      position: 'middle'
    })
    expect(got).toEqual(b)
  })

  it('空分路按 null 传（大乱斗 / 匹配自选由后端判定模式）', async () => {
    mockInvoke.mockResolvedValue(null)

    await fetchChampionBuild(157, 'ARAM', '')

    expect(mockInvoke).toHaveBeenCalledWith('get_champion_build', {
      championId: 157,
      gameMode: 'ARAM',
      position: null
    })
  })

  it('命令失败吞掉返回 null（数据缺失是常态降级）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockInvoke.mockRejectedValue('boom')
    expect(await fetchChampionBuild(157, 'CLASSIC', 'middle')).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('applyRunePage', () => {
  it('把英雄 / 分路 / 符文原样交给后端写临时页', async () => {
    mockInvoke.mockResolvedValue({ ok: true, page_id: 42, reason: null })
    const r = rune(1000)

    const got = await applyRunePage(157, 'middle', r)

    expect(mockInvoke).toHaveBeenCalledWith('apply_rune_page', {
      championId: 157,
      position: 'middle',
      rune: r
    })
    expect(got).toEqual({ ok: true, page_id: 42, reason: null })
  })

  it('命令本身异常时归一成失败结果，不向上抛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockInvoke.mockRejectedValue('ipc down')

    const got = await applyRunePage(157, 'middle', rune(1000))

    expect(got.ok).toBe(false)
    expect(got.reason).toBe('lcu_unavailable')
    warn.mockRestore()
  })
})

describe('applyFailureText', () => {
  it('页满时明确让用户自己删页，绝不暗示我们会删', () => {
    expect(applyFailureText('page_limit_full')).toBe('符文页已满，请手动删除一页后重试')
  })

  it('其余原因给出可读文案', () => {
    expect(applyFailureText('lcu_unavailable')).toContain('客户端')
    expect(applyFailureText('lcu_rejected')).toContain('拒绝')
    expect(applyFailureText(null)).toContain('失败')
  })
})

// ---- 符文方案（多方案卡片 + 我的方案）----

function preset(keystone: number, position = 'middle'): RunePreset {
  return presetFromRune(157, position, rune(0, keystone), 1_789_000_000_000)
}

describe('presetFromRune / presetToRune', () => {
  it('互转保留两个系与 9 个符文的顺序，统计清零', () => {
    const p = presetFromRune(157, 'middle', rune(900, 8008), 42)
    expect(p).toMatchObject({ champion_id: 157, position: 'middle', saved_at: 42, source: 'opgg' })
    expect(presetToRune(p)).toEqual({ ...rune(900, 8008), play: 0, win: 0, pick_rate: 0 })
  })
})

describe('buildRuneOptions', () => {
  const b = build([rune(5000, 8008), rune(150, 8021), rune(900, 8010)])

  it('OP.GG 每套一张卡，样本不足 200 场的标出来', () => {
    const opts = buildRuneOptions(b, null)
    expect(opts.map(o => o.key)).toEqual(['opgg-0', 'opgg-1', 'opgg-2'])
    expect(opts.map(o => o.sufficient)).toEqual([true, false, true])
    expect(opts.every(o => o.source === 'opgg' && !o.starred)).toBe(true)
  })

  it('我的方案与某套 OP.GG 构筑相同：不另起卡，给那张加 ★', () => {
    const opts = buildRuneOptions(b, preset(8010))
    expect(opts.map(o => o.key)).toEqual(['opgg-0', 'opgg-1', 'opgg-2'])
    expect(opts.map(o => o.starred)).toEqual([false, false, true])
  })

  it('我的方案不在 OP.GG 里：最前面单独一张「我的」卡', () => {
    const opts = buildRuneOptions(b, preset(8229))
    expect(opts[0]).toMatchObject({
      key: 'preset',
      source: 'preset',
      starred: true,
      sufficient: true
    })
    expect(opts).toHaveLength(4)
  })

  it('OP.GG 没数据时只剩我的方案；都没有则为空', () => {
    expect(buildRuneOptions(null, preset(8008)).map(o => o.key)).toEqual(['preset'])
    expect(buildRuneOptions(null, null)).toEqual([])
  })
})

describe('defaultOptionKey', () => {
  it('我的方案 → 第一套样本达标的 → 第一套', () => {
    const b = build([rune(150, 8021), rune(900, 8010)])
    expect(defaultOptionKey(buildRuneOptions(b, preset(8010)))).toBe('opgg-1')
    expect(defaultOptionKey(buildRuneOptions(b, null))).toBe('opgg-1')
    expect(defaultOptionKey(buildRuneOptions(build([rune(150, 8021)]), null))).toBe('opgg-0')
    expect(defaultOptionKey([])).toBeNull()
  })
})

describe('autoTargetKey', () => {
  const b = build([rune(150, 8021), rune(900, 8010)])

  it('有我的方案时自动写它', () => {
    expect(autoTargetKey(buildRuneOptions(b, preset(8229)), true, 'opgg')).toBe('preset')
    expect(autoTargetKey(buildRuneOptions(b, preset(8021)), true, 'none')).toBe('opgg-0')
  })

  it('没有方案：兜底为 OP.GG 取样本达标的第一套，否则不写', () => {
    expect(autoTargetKey(buildRuneOptions(b, null), false, 'opgg')).toBe('opgg-1')
    expect(autoTargetKey(buildRuneOptions(b, null), false, 'none')).toBeNull()
    expect(
      autoTargetKey(buildRuneOptions(build([rune(150, 8021)]), null), false, 'opgg')
    ).toBeNull()
  })
})

describe('presetPositionOf', () => {
  it('优先用构筑已解析的分路（含匹配自选时的主分路）', () => {
    expect(presetPositionOf(build([]), 'CLASSIC', null)).toBe('middle')
  })

  it('无构筑时：大乱斗类为 none，其余用分配分路', () => {
    expect(presetPositionOf(null, 'ARAM', null)).toBe('none')
    expect(presetPositionOf(null, 'KIWI', 'middle')).toBe('none')
    expect(presetPositionOf(null, 'CLASSIC', 'MIDDLE')).toBe('middle')
    expect(presetPositionOf(null, 'CLASSIC', '')).toBeNull()
  })
})
