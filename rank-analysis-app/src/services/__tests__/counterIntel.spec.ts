/**
 * counterIntel service 单元测试：位置映射 / 排序 / 文案 / P2 评分。
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import {
  computeBestPicks,
  formatCounterLine,
  formatSynergyLine,
  getChampionIntel,
  positionToOpgg,
  sortCounters,
  sortSynergies,
  type ChampionIntel,
  type CounterItem,
  type SynergyItem
} from '../counterIntel'

function counter(championId: number, winRate: number, play: number): CounterItem {
  return { championId, play, win: Math.round(winRate * play), winRate }
}

function intelOf(region: string, tier: string, counters: CounterItem[]): ChampionIntel {
  return { region, tier, fetchedAt: 0, stale: false, counters, synergies: [] }
}

describe('positionToOpgg', () => {
  it('LCU 命名 → OP.GG 命名', () => {
    expect(positionToOpgg('TOP')).toBe('TOP')
    expect(positionToOpgg('JUNGLE')).toBe('JUNGLE')
    expect(positionToOpgg('MIDDLE')).toBe('MID')
    expect(positionToOpgg('BOTTOM')).toBe('ADC')
    expect(positionToOpgg('UTILITY')).toBe('SUPPORT')
  })

  it('OP.GG 命名原样返回（双兼容）', () => {
    expect(positionToOpgg('MID')).toBe('MID')
    expect(positionToOpgg('ADC')).toBe('ADC')
    expect(positionToOpgg('SUPPORT')).toBe('SUPPORT')
  })

  it('未知命名返回 null', () => {
    expect(positionToOpgg('TOP_LANE')).toBeNull()
    expect(positionToOpgg('')).toBeNull()
  })
})

describe('sortCounters', () => {
  const items = [counter(10, 0.44, 200), counter(20, 0.52, 100), counter(30, 0.52, 300)]

  it('胜率降序为默认方向', () => {
    const got = sortCounters(items, 'winRate', 'desc')
    expect(got.map(c => c.championId)).toEqual([20, 30, 10])
  })

  it('胜率升序', () => {
    const got = sortCounters(items, 'winRate', 'asc')
    expect(got.map(c => c.championId)).toEqual([10, 20, 30])
  })

  it('场次降序', () => {
    const got = sortCounters(items, 'play', 'desc')
    expect(got.map(c => c.championId)).toEqual([30, 10, 20])
  })

  it('不修改原数组', () => {
    const before = items.map(c => c.championId)
    sortCounters(items, 'play', 'asc')
    expect(items.map(c => c.championId)).toEqual(before)
  })
})

describe('formatCounterLine', () => {
  it('胜率保留一位小数并带局数', () => {
    expect(formatCounterLine(0.5714, 120)).toBe('57.1% · 120 局')
    expect(formatCounterLine(0.5, 0)).toBe('50.0% · 0 局')
  })
})

function synergy(championId: number, winRate: number, play: number): SynergyItem {
  return { synergyChampionId: championId, synergyPosition: 'SUPPORT', winRate, play }
}

describe('sortSynergies（V1.1 最佳搭档）', () => {
  const items = [synergy(10, 0.44, 200), synergy(20, 0.52, 100), synergy(30, 0.52, 300)]

  it('胜率降序为默认方向', () => {
    const got = sortSynergies(items, 'winRate', 'desc')
    expect(got.map(s => s.synergyChampionId)).toEqual([20, 30, 10])
  })

  it('胜率升序', () => {
    const got = sortSynergies(items, 'winRate', 'asc')
    expect(got.map(s => s.synergyChampionId)).toEqual([10, 20, 30])
  })

  it('场次降序', () => {
    const got = sortSynergies(items, 'play', 'desc')
    expect(got.map(s => s.synergyChampionId)).toEqual([30, 10, 20])
  })

  it('不修改原数组', () => {
    const before = items.map(s => s.synergyChampionId)
    sortSynergies(items, 'play', 'asc')
    expect(items.map(s => s.synergyChampionId)).toEqual(before)
  })
})

describe('formatSynergyLine（V1.1 最佳搭档）', () => {
  it('胜率保留一位小数并带局数', () => {
    expect(formatSynergyLine(0.553, 890)).toBe('55.3% · 890 局')
    expect(formatSynergyLine(0.5, 0)).toBe('50.0% · 0 局')
  })
})

describe('getChampionIntel', () => {
  it('透传 invoke 参数并返回 intel', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(intelOf('global', 'emerald_plus', []))
    const intel = await getChampionIntel('global', 34, 'TOP', 'emerald_plus')
    expect(invoke).toHaveBeenCalledWith('get_champion_intel', {
      region: 'global',
      championId: 34,
      position: 'TOP',
      tier: 'emerald_plus'
    })
    expect(intel?.region).toBe('global')
  })

  it('失败返回 null 不抛', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('boom')
    expect(await getChampionIntel('global', 34, 'TOP', 'emerald_plus')).toBeNull()
  })
})

describe('computeBestPicks（P2 评分）', () => {
  it('反查敌方 intel 评分：克制加分、被克减分、未知归零', () => {
    const enemyIntel = new Map<number, ChampionIntel>()
    // 敌方 100（盲僧）：对候选 1 胜率 0.42 → 候选 1 打盲僧 0.58（+0.08）
    // 敌方 100：对候选 2 胜率 0.60 → 候选 2 打盲僧 0.40（-0.10）
    // 敌方 200（赵信）：对候选 1 胜率 0.55 → 候选 1 打赵信 0.45（-0.05）
    //   → 候选 1 总分 0.03；候选 2 总分 -0.10；候选 3 全未知 0
    enemyIntel.set(
      100,
      intelOf('global', 'emerald_plus', [counter(1, 0.42, 210), counter(2, 0.6, 90)])
    )
    enemyIntel.set(200, intelOf('global', 'emerald_plus', [counter(1, 0.55, 150)]))

    const picks = computeBestPicks([1, 2, 3], enemyIntel)

    expect(picks).toHaveLength(3)
    // 排序：候选 1 (+0.03) > 候选 3 (0，全未知) > 候选 2 (-0.10)
    expect(picks[0].championId).toBe(1)
    expect(picks[0].score).toBeCloseTo(0.03)

    const first = picks[0]
    expect(first.evidences).toHaveLength(2)
    // 对盲僧：favored（0.58 > 0.5）
    const vs100 = first.evidences.find(e => e.againstChampionId === 100)!
    expect(vs100.relation).toBe('favored')
    expect(vs100.winRate).toBeCloseTo(0.58)
    expect(vs100.play).toBe(210)
    // 对赵信：countered（0.45 < 0.5）
    const vs200 = first.evidences.find(e => e.againstChampionId === 200)!
    expect(vs200.relation).toBe('countered')
    expect(vs200.winRate).toBeCloseTo(0.45)

    // 候选 3：全未知 → 0 分、无证据
    expect(picks[1].championId).toBe(3)
    expect(picks[1].score).toBe(0)
    expect(picks[1].evidences).toHaveLength(0)

    // 候选 2：被克制，分数为负
    expect(picks[2].championId).toBe(2)
    expect(picks[2].score).toBeCloseTo(-0.1)
    expect(picks[2].evidences[0].relation).toBe('countered')
  })

  it('同分按总场次降序，再按 championId 升序', () => {
    const enemyIntel = new Map<number, ChampionIntel>()
    // 候选 10 与 20 对盲僧胜率相同（同 +0.05），但候选 10 样本更多
    enemyIntel.set(
      100,
      intelOf('global', 'emerald_plus', [counter(10, 0.45, 400), counter(20, 0.45, 100)])
    )
    const picks = computeBestPicks([20, 10], enemyIntel)
    expect(picks[0].championId).toBe(10)
    expect(picks[1].championId).toBe(20)
  })

  it('完全同分同场次按 championId 升序', () => {
    const enemyIntel = new Map<number, ChampionIntel>()
    enemyIntel.set(
      100,
      intelOf('global', 'emerald_plus', [counter(5, 0.5, 100), counter(7, 0.5, 100)])
    )
    const picks = computeBestPicks([7, 5], enemyIntel)
    expect(picks.map(p => p.championId)).toEqual([5, 7])
  })

  it('空敌方 → 空结果；空候选 → 空结果', () => {
    expect(computeBestPicks([1, 2], new Map())).toEqual([])
    expect(computeBestPicks([], new Map())).toEqual([])
  })
})
