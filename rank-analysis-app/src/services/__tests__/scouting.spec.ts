/**
 * scouting 服务（M4 战场六）单元测试。
 *
 * 覆盖：
 * - getThreatRatings 正确调用 get_threat_ratings 命令并透传结果；
 * - 威胁等级标签/颜色常量覆盖全部 4 个等级。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  getThreatRatings,
  THREAT_LEVEL_LABELS,
  THREAT_LEVEL_COLORS,
  type ThreatRating
} from '../scouting'

const mockInvoke = vi.mocked(invoke)

function sampleRating(overrides: Partial<ThreatRating> = {}): ThreatRating {
  return {
    threatLevel: 'Medium',
    styleTags: [],
    encounterCount: 0,
    laneAggression: 1.2,
    recentPerformance: 8.0,
    mainChampionWinRate: null,
    caveats: [],
    puuid: 'p1',
    position: 'TOP',
    ...overrides
  }
}

describe('scouting service', () => {
  it('should call get_threat_ratings command', async () => {
    const ratings = [sampleRating(), sampleRating({ puuid: 'p2', position: 'JUNGLE' })]
    mockInvoke.mockResolvedValueOnce(ratings)

    const result = await getThreatRatings()

    expect(mockInvoke).toHaveBeenCalledWith('get_threat_ratings')
    expect(result).toHaveLength(2)
    expect(result[0].puuid).toBe('p1')
  })

  it('should propagate empty result from backend', async () => {
    mockInvoke.mockResolvedValueOnce([])
    await expect(getThreatRatings()).resolves.toEqual([])
  })

  it('should propagate command errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('拿不到选人会话'))
    await expect(getThreatRatings()).rejects.toThrow('拿不到选人会话')
  })
})

describe('threat level constants', () => {
  it('should label all four threat levels', () => {
    expect(Object.keys(THREAT_LEVEL_LABELS).sort()).toEqual([
      'Critical',
      'High',
      'Low',
      'Medium'
    ])
    for (const label of Object.values(THREAT_LEVEL_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('should color all four threat levels with hex values', () => {
    expect(Object.keys(THREAT_LEVEL_COLORS).sort()).toEqual([
      'Critical',
      'High',
      'Low',
      'Medium'
    ])
    for (const color of Object.values(THREAT_LEVEL_COLORS)) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('should use distinct colors per level', () => {
    const colors = Object.values(THREAT_LEVEL_COLORS)
    expect(new Set(colors).size).toBe(colors.length)
  })
})