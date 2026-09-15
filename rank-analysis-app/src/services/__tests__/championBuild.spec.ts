import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  applyRunePage,
  applyFailureText,
  fetchChampionBuild,
  pickRecommendedRune
} from '../championBuild'
import type { ChampionBuild, RuneBuild } from '@renderer/types/championBuild'

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

describe('pickRecommendedRune', () => {
  it('取第一套样本达标的构筑', () => {
    const got = pickRecommendedRune(build([rune(150, 8021), rune(900, 8008)]))
    expect(got.sufficient).toBe(true)
    expect(got.rune?.primary_perk_ids[0]).toBe(8008)
  })

  it('全部低于阈值时退回第一套并标样本不足', () => {
    const got = pickRecommendedRune(build([rune(199, 8021), rune(50, 8008)]))
    expect(got.sufficient).toBe(false)
    expect(got.rune?.primary_perk_ids[0]).toBe(8021)
  })

  it('无符文或无数据时 rune 为 null', () => {
    expect(pickRecommendedRune(build([])).rune).toBeNull()
    expect(pickRecommendedRune(null).rune).toBeNull()
  })
})
