import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { fetchChampionBuild, pickRecommendedRune } from '../championBuild'
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
