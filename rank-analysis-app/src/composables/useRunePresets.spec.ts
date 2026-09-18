import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { useRunePresets } from './useRunePresets'
import type { RunePreset } from '@renderer/types/championBuild'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)

function preset(championId: number, position: string, keystone = 8008, savedAt = 1): RunePreset {
  return {
    champion_id: championId,
    position,
    primary_style_id: 8000,
    sub_style_id: 8400,
    primary_perk_ids: [keystone, 9101, 9104, 8299],
    sub_perk_ids: [8444, 8451],
    stat_mod_ids: [5005, 5008, 5001],
    saved_at: savedAt,
    source: 'opgg'
  }
}

let store: Record<string, unknown> = {}

beforeEach(() => {
  vi.clearAllMocks()
  store = {}
  mockGet.mockImplementation(async (key: string) => store[key])
  mockPut.mockImplementation(async (key: string, value: unknown) => {
    store[key] = value
  })
})

describe('useRunePresets', () => {
  it('未配置时方案为空、兜底默认用 OP.GG', async () => {
    store['settings.auto.runePresets'] = ''
    store['settings.auto.runeFallback'] = ''
    const r = useRunePresets()
    await r.reload()
    expect(r.presets.value).toEqual([])
    expect(r.fallback.value).toBe('opgg')
  })

  it('读取已存方案，丢弃拼不出页的坏条目', async () => {
    const broken = { ...preset(86, 'top'), sub_perk_ids: [8444] }
    store['settings.auto.runePresets'] = [preset(157, 'middle'), broken]
    store['settings.auto.runeFallback'] = 'none'
    const r = useRunePresets()
    await r.reload()
    expect(r.presets.value.map(p => p.champion_id)).toEqual([157])
    expect(r.fallback.value).toBe('none')
  })

  it('记住覆盖同一英雄同一分路的旧方案，并落盘', async () => {
    store['settings.auto.runePresets'] = [preset(157, 'middle', 8008), preset(157, 'none', 8010)]
    const r = useRunePresets()
    await r.reload()

    await r.remember(preset(157, 'middle', 8021, 99))

    const saved = store['settings.auto.runePresets'] as RunePreset[]
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({ position: 'middle', saved_at: 99 })
    expect(saved[0].primary_perk_ids[0]).toBe(8021)
    // 大乱斗那套不受影响
    expect(r.find(157, 'none')?.primary_perk_ids[0]).toBe(8010)
  })

  it('取消记住只删这一条', async () => {
    store['settings.auto.runePresets'] = [preset(157, 'middle'), preset(86, 'top')]
    const r = useRunePresets()
    await r.reload()

    await r.forget(157, 'middle')

    expect(mockPut).toHaveBeenCalledWith('settings.auto.runePresets', [preset(86, 'top')])
    expect(r.find(157, 'middle')).toBeNull()
  })

  it('切换兜底策略落盘', async () => {
    const r = useRunePresets()
    await r.setFallback('none')
    expect(mockPut).toHaveBeenCalledWith('settings.auto.runeFallback', 'none')
    expect(r.fallback.value).toBe('none')
  })
})
