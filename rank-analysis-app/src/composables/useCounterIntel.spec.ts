/**
 * useCounterIntel / useBestPicks 单元测试：
 * 防抖合并 / 缓存命中 / revision 失效 / 失败降级 / 空输入不发请求。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  clearCounterIntelCache,
  sortedSynergies,
  useBestPicks,
  useCounterIntel
} from './useCounterIntel'
import { getChampionIntel } from '@renderer/services/counterIntel'
import { bumpOpggRevision, getChampionMeta } from '@renderer/services/opgg'

vi.mock('@renderer/services/counterIntel', async importOriginal => {
  const actual = await importOriginal<typeof import('@renderer/services/counterIntel')>()
  return {
    ...actual,
    getChampionIntel: vi.fn()
  }
})

vi.mock('@renderer/services/opgg', async () => {
  const { ref } = await import('vue')
  const revision = ref(0)
  return {
    getChampionMeta: vi.fn(),
    opggRevision: revision,
    bumpOpggRevision: () => {
      revision.value += 1
    }
  }
})

const mockedGetChampionIntel = vi.mocked(getChampionIntel)
const mockedGetChampionMeta = vi.mocked(getChampionMeta)

const DEBOUNCE = 150

function makeIntel(
  championId: number,
  winRate: number = 0.55
): NonNullable<Awaited<ReturnType<typeof getChampionIntel>>> {
  return {
    region: 'global',
    tier: 'emerald_plus',
    fetchedAt: 0,
    stale: false,
    counters: [{ championId, play: 100, win: 55, winRate }],
    synergies: []
  }
}

describe('useCounterIntel', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.clearAllMocks()
    clearCounterIntelCache()
    vi.useFakeTimers()
    scope = effectScope()
  })

  afterEach(() => {
    // 销毁本测试的 watch/timer，避免旧实例在 revision 变化时重复请求
    scope.stop()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('championId ≤ 0 或空位置不发请求', async () => {
    const id = ref(0)
    const pos = ref('TOP')
    scope.run(() => useCounterIntel(id, pos, ref('emerald_plus')))
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)
    expect(mockedGetChampionIntel).not.toHaveBeenCalled()

    id.value = 34
    pos.value = ''
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)
    expect(mockedGetChampionIntel).not.toHaveBeenCalled()
  })

  it('同一 championId 下快速重复触发只发一次请求（防抖）', async () => {
    const id = ref(34)
    const pos = ref('TOP')
    mockedGetChampionIntel.mockResolvedValue(makeIntel(34))
    scope.run(() => useCounterIntel(id, pos, ref('emerald_plus')))

    // 模拟连续三次悬浮触发（60ms 间隔，均落在防抖窗口内）
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(60)
    }
    // 防抖窗口结束才真正请求
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    expect(mockedGetChampionIntel).toHaveBeenCalledTimes(1)
  })

  it('缓存命中后再次悬浮不重发请求', async () => {
    const id = ref(34)
    const pos = ref('TOP')
    mockedGetChampionIntel.mockResolvedValue(makeIntel(34))
    const { intel: intelA } = scope.run(() => useCounterIntel(id, pos, ref('emerald_plus')))!

    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    expect(intelA.value).not.toBeNull()

    // 离开再悬浮（触发 watch 但缓存命中）
    id.value = 0
    await nextTick()
    id.value = 34
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)
    expect(mockedGetChampionIntel).toHaveBeenCalledTimes(1)
  })

  it('opggRevision 变化后清缓存重取', async () => {
    const id = ref(34)
    const pos = ref('TOP')
    mockedGetChampionIntel.mockResolvedValue(makeIntel(34))
    scope.run(() => useCounterIntel(id, pos, ref('emerald_plus')))

    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    expect(mockedGetChampionIntel).toHaveBeenCalledTimes(1)

    // 回到缓存命中（不重发）
    id.value = 0
    await nextTick()
    expect(mockedGetChampionIntel).toHaveBeenCalledTimes(1)
    id.value = 34
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)
    expect(mockedGetChampionIntel).toHaveBeenCalledTimes(1)

    // 段位切换：清缓存强制重取。清空历史计数，只统计 revision 失效后的重取
    mockedGetChampionIntel.mockClear()
    bumpOpggRevision()
    await nextTick()
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    expect(mockedGetChampionIntel).toHaveBeenCalledTimes(1)
  })

  it('请求失败 → error=true 且 intel=null；后续成功恢复', async () => {
    const id = ref(34)
    const pos = ref('TOP')
    mockedGetChampionIntel.mockRejectedValueOnce('boom')
    const { intel, error } = scope.run(() => useCounterIntel(id, pos, ref('emerald_plus')))!

    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    expect(error.value).toBe(true)
    expect(intel.value).toBeNull()

    mockedGetChampionIntel.mockResolvedValue(makeIntel(34))
    id.value = 0
    await nextTick()
    id.value = 34
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    expect(error.value).toBe(false)
    expect(intel.value).not.toBeNull()
  })
})

describe('useBestPicks', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.clearAllMocks()
    clearCounterIntelCache()
    vi.useFakeTimers()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('敌方未锁定或候选为空 → 不发请求、picks 空', async () => {
    const enemyIds = ref<number[]>([])
    const candidates = ref<number[]>([1, 2])
    const { picks } = scope.run(() => useBestPicks(enemyIds, candidates, ref('emerald_plus')))!
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)
    expect(picks.value).toEqual([])
    expect(mockedGetChampionIntel).not.toHaveBeenCalled()

    enemyIds.value = [100]
    candidates.value = []
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 10)
    expect(picks.value).toEqual([])
  })

  it('按敌方主分路拉取情报并计算推荐', async () => {
    const enemyIds = ref<number[]>([100])
    const candidates = ref<number[]>([1, 2])
    mockedGetChampionMeta.mockResolvedValue({
      championId: 100,
      position: 'MIDDLE',
      tier: 1,
      rank: 1,
      rankPrevPatch: 0,
      winRate: 0.5,
      pickRate: 0.1,
      banRate: 0.05,
      roleRate: 0.8,
      isMainPosition: true
    })
    // 敌方 100 对候选 1 胜率 0.45 → 候选 1 打 100 0.55（+0.05）
    // 敌方 100 对候选 2 胜率 0.6  → 候选 2 打 100 0.40（-0.10）
    mockedGetChampionIntel.mockImplementation(async (_r, championId) => {
      if (championId === 100) {
        return {
          region: 'global',
          tier: 'emerald_plus',
          fetchedAt: 0,
          stale: false,
          counters: [
            { championId: 1, play: 200, win: 90, winRate: 0.45 },
            { championId: 2, play: 100, win: 60, winRate: 0.6 }
          ],
          synergies: []
        }
      }
      return null
    })

    const { picks, isLoading } = scope.run(() =>
      useBestPicks(enemyIds, candidates, ref('emerald_plus'))
    )!
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()

    expect(mockedGetChampionMeta).toHaveBeenCalledWith('ranked', 100)
    // 位置映射：MIDDLE → MID
    expect(mockedGetChampionIntel).toHaveBeenCalledWith('global', 100, 'MID', 'emerald_plus')
    expect(picks.value[0].championId).toBe(1)
    expect(picks.value[0].score).toBeCloseTo(0.05)
    expect(picks.value[1].championId).toBe(2)
    expect(picks.value[1].score).toBeCloseTo(-0.1)
    expect(isLoading.value).toBe(false)
  })

  it('快照无该敌方英雄 → 跳过该敌方（不编造）', async () => {
    const enemyIds = ref<number[]>([100])
    const candidates = ref<number[]>([1])
    mockedGetChampionMeta.mockResolvedValue(null)
    const { picks } = scope.run(() => useBestPicks(enemyIds, candidates, ref('emerald_plus')))!
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await nextTick()
    expect(picks.value).toEqual([])
  })
})

describe('sortedSynergies（V1.1 最佳搭档）', () => {
  it('按胜率降序返回搭档列表', () => {
    const intel = {
      region: 'global',
      tier: 'emerald_plus',
      fetchedAt: 0,
      stale: false,
      counters: [],
      synergies: [
        { synergyChampionId: 10, synergyPosition: 'SUPPORT', winRate: 0.5, play: 100 },
        { synergyChampionId: 20, synergyPosition: 'SUPPORT', winRate: 0.58, play: 200 }
      ]
    }
    const got = sortedSynergies(intel, 'winRate', 'desc')
    expect(got.map(s => s.synergyChampionId)).toEqual([20, 10])
  })

  it('空数据返回空数组', () => {
    expect(sortedSynergies(null, 'winRate', 'desc')).toEqual([])
  })
})
