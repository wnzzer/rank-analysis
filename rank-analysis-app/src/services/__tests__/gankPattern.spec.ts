/**
 * gankPattern 单元测试：SGP 原始击杀事件 → 归路聚合 → 提示行文案。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aggregateGankPattern,
  fetchJungleGankPattern,
  formatGankPatternLine,
  type GankPatternRaw
} from '@renderer/services/gankPattern'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'

const mockedInvoke = vi.mocked(invoke)

function raw(overrides: Partial<GankPatternRaw> = {}): GankPatternRaw {
  return {
    analyzedGames: 20,
    jungleGames: 8,
    firstKillMs: 250_000,
    killEvents: [
      { timestampMs: 250_000, victimChampionId: 202 },
      { timestampMs: 300_000, victimChampionId: 102 },
      { timestampMs: 360_000, victimChampionId: 202 }
    ],
    ...overrides
  }
}

/** victim 英雄 → OP.GG 主分路（模拟 getChampionMeta 缓存映射） */
function positionOf(id: number): string | undefined {
  const map: Record<number, string> = { 202: 'bottom', 102: 'top', 51: 'utility' }
  return map[id]
}

describe('aggregateGankPattern', () => {
  it('victim 英雄按分路归路：下路英雄计入 BOTTOM', () => {
    const s = aggregateGankPattern(raw(), positionOf)
    expect(s.totalKills).toBe(3)
    expect(s.laneDistribution).toEqual({ BOTTOM: 2, TOP: 1 })
    // 下路占比 67% ≥60% 且 ≥2 次 → 明确倾向
    expect(s.topLane).toBe('BOTTOM')
    expect(s.topLaneRatio).toBe(67)
  })

  it('辅助（UTILITY）击杀归入下路', () => {
    const r = raw({ killEvents: [{ timestampMs: 100_000, victimChampionId: 51 }] })
    const s = aggregateGankPattern(r, positionOf)
    expect(s.laneDistribution).toEqual({ BOTTOM: 1 })
    // 仅 1 次：不满足 ≥2 次 → 无明确倾向
    expect(s.topLane).toBeNull()
  })

  it('未知英雄归入 OTHER；victim 0（摘要缺映射）跳过不计', () => {
    const r = raw({
      killEvents: [
        { timestampMs: 100_000, victimChampionId: 0 },
        { timestampMs: 150_000, victimChampionId: 999 },
        { timestampMs: 200_000, victimChampionId: 202 }
      ]
    })
    const s = aggregateGankPattern(r, positionOf)
    expect(s.totalKills).toBe(2)
    expect(s.laneDistribution).toEqual({ OTHER: 1, BOTTOM: 1 })
  })

  it('占比不足 60% 时不标 topLane（防噪音）', () => {
    const r = raw({
      killEvents: [
        { timestampMs: 100_000, victimChampionId: 202 },
        { timestampMs: 150_000, victimChampionId: 102 },
        { timestampMs: 200_000, victimChampionId: 51 },
        { timestampMs: 250_000, victimChampionId: 999 }
      ]
    })
    const s = aggregateGankPattern(r, positionOf)
    expect(s.totalKills).toBe(4)
    // 下路 2/4 = 50% < 60% → 无明确倾向
    expect(s.topLane).toBeNull()
    expect(s.topLaneRatio).toBeNull()
  })

  it('无击杀事件：空分布 + firstKill 透传', () => {
    const s = aggregateGankPattern(raw({ killEvents: [], firstKillMs: null }), positionOf)
    expect(s.totalKills).toBe(0)
    expect(s.laneDistribution).toEqual({})
    expect(s.topLane).toBeNull()
    expect(s.firstKillMs).toBeNull()
  })
})

describe('formatGankPatternLine', () => {
  it('有击杀：分布按次数降序 + 首杀 m:ss', () => {
    const s = aggregateGankPattern(raw(), positionOf)
    expect(formatGankPatternLine(s)).toBe(
      '敌方打野近 8 局前 10 分钟参与击杀 3 次：下路 67%（2次）、上路 33%（1次），首杀 4:10'
    )
  })

  it('无击杀：节奏偏慢结论', () => {
    const s = aggregateGankPattern(raw({ killEvents: [], firstKillMs: null }), positionOf)
    expect(formatGankPatternLine(s)).toBe('敌方打野近 8 局前 10 分钟无参与击杀（前期节奏偏慢）')
  })

  it('无首杀事件时不输出首杀段', () => {
    const r = raw({ firstKillMs: null })
    const s = aggregateGankPattern(r, positionOf)
    const line = formatGankPatternLine(s)
    expect(line).toContain('参与击杀 3 次')
    expect(line).not.toContain('首杀')
  })
})

describe('fetchJungleGankPattern', () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
  })
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules?.()
  })

  it('invoke 成功：透传 region/puuid 并返回 raw', async () => {
    const r = raw()
    mockedInvoke.mockResolvedValue(r)
    const result = await fetchJungleGankPattern({ region: 'TJ100', puuid: 'p-ok' })
    expect(result).toEqual(r)
    expect(mockedInvoke).toHaveBeenCalledWith('get_jungle_gank_pattern', {
      region: 'TJ100',
      puuid: 'p-ok',
      name: null
    })
  })

  it('invoke 返回 null（样本不足）：透传 null', async () => {
    mockedInvoke.mockResolvedValue(null)
    expect(await fetchJungleGankPattern({ region: 'TJ100', puuid: 'p-null' })).toBeNull()
  })

  it('invoke 失败：吞错返回 null', async () => {
    mockedInvoke.mockRejectedValue(new Error('boom'))
    expect(await fetchJungleGankPattern({ region: 'TJ100', puuid: 'p-fail' })).toBeNull()
  })

  it('同目标并发去重：inflight 只发一次 invoke', async () => {
    mockedInvoke.mockResolvedValue(raw())
    const p1 = fetchJungleGankPattern({ region: 'TJ100', puuid: 'p-dedupe' })
    const p2 = fetchJungleGankPattern({ region: 'TJ100', puuid: 'p-dedupe' })
    await Promise.all([p1, p2])
    expect(mockedInvoke).toHaveBeenCalledTimes(1)
  })
})
