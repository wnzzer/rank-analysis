import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import { queueIdToOpggMode, getChampionMeta, findCounterHints, ensureOpggData } from '../opgg'
import type { LaneCounter } from '../opgg'

describe('opgg service', () => {
  it('queueIdToOpggMode: 450→aram, 420/440/其他→ranked', () => {
    expect(queueIdToOpggMode(450)).toBe('aram')
    expect(queueIdToOpggMode(420)).toBe('ranked')
    expect(queueIdToOpggMode(0)).toBe('ranked')
  })

  it('getChampionMeta 透传 invoke 并容错', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ championId: 86, tier: 1 })
    const m = await getChampionMeta('ranked', 86, 'TOP')
    expect(invoke).toHaveBeenCalledWith('get_champion_meta', {
      mode: 'ranked',
      championId: 86,
      position: 'TOP'
    })
    expect(m?.tier).toBe(1)
    vi.mocked(invoke).mockRejectedValueOnce('boom')
    expect(await getChampionMeta('ranked', 86)).toBeNull()
  })

  it('ensureOpggData 失败返回 null 不抛', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('net down')
    expect(await ensureOpggData('ranked')).toBeNull()
  })

  it('findCounterHints 双向克制判定与排序', () => {
    const counters: Record<number, LaneCounter[]> = {
      // 敌方 10 最怕我方 86（10 对 86 胜率 0.44 → 我方 86 对其 0.56）
      10: [{ opponentId: 86, position: 'TOP', subjectWinRate: 0.44, play: 4000 }],
      // 我方 99 被敌方 10 克制（99 对 10 胜率 0.42）
      99: [{ opponentId: 10, position: 'MIDDLE', subjectWinRate: 0.42, play: 3000 }]
    }
    const hints = findCounterHints(10, [86, 99], counters)
    expect(hints).toHaveLength(2)
    expect(hints[0].myChampionId).toBe(99) // |0.5-0.42|=0.08 > |0.5-0.56|=0.06
    expect(hints[0].myWinRate).toBeCloseTo(0.42)
    expect(hints[1].myWinRate).toBeCloseTo(0.56)
  })

  it('findCounterHints 无关联返回空', () => {
    expect(findCounterHints(10, [86], {})).toEqual([])
  })
})
