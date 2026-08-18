/**
 * useMinuteCurve 单测：懒加载 / 串行拉取 / 失败跳过 / generation 防串 / 空输入。
 * getSgpMatchDetail 与 minuteCurve 聚合均为可注入依赖（mock）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useMinuteCurve, type CurveGameSource } from './useMinuteCurve'
import { getSgpMatchDetail } from '@renderer/features/record/services/sgp'
import { MINUTE_CURVE_LIMIT } from './useMinuteCurve'

vi.mock('@renderer/features/record/services/sgp', async importOriginal => {
  const actual = await importOriginal<typeof import('@renderer/features/record/services/sgp')>()
  return {
    ...actual,
    getSgpMatchDetail: vi.fn()
  }
})

const mockedDetail = vi.mocked(getSgpMatchDetail)

const SELF = 'puuid-me'

/** 构造一个可解析的 SGP 详情（帧 0 分钟 → maxMinute 分钟，自身在 participant 10） */
function makeDetail(maxMinute: number, cs: number = 20) {
  const frames = []
  for (let m = 0; m <= maxMinute; m++) {
    frames.push({
      timestamp: m * 60_000,
      events: [],
      participantFrames: { 10: { minionsKilled: Math.min(cs, m * 2), jungleMinionsKilled: 0 } }
    })
  }
  return {
    metadata: {},
    json: { frames, participants: [{ participantId: 10, puuid: SELF }] }
  }
}

function gamesOf(n: number): CurveGameSource[] {
  return Array.from({ length: n }, (_, i) => ({ gameId: 100 + i, platformId: 'TJ100' }))
}

describe('useMinuteCurve', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.clearAllMocks()
    mockedDetail.mockResolvedValue(makeDetail(5))
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
  })

  it('空游戏列表 / 空 puuid → 不请求，curve null', async () => {
    const { curve, loading, load } = scope.run(() =>
      useMinuteCurve(ref<CurveGameSource[]>([]), ref(SELF))
    )!
    await load()
    expect(mockedDetail).not.toHaveBeenCalled()
    expect(curve.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('按最近 limit 场串行拉取并聚合', async () => {
    const { curve, attempted, load } = scope.run(() => useMinuteCurve(ref(gamesOf(12)), ref(SELF)))!
    await load()
    expect(mockedDetail).toHaveBeenCalledTimes(MINUTE_CURVE_LIMIT)
    // 串行：请求按顺序发出（每次 await 完成才发下一个）
    const first = mockedDetail.mock.calls[0]
    expect(first).toEqual(['TJ100', 100])
    expect(curve.value).not.toBeNull()
    expect(curve.value!.sourceCount).toBe(MINUTE_CURVE_LIMIT)
    expect(attempted.value).toBe(MINUTE_CURVE_LIMIT)
  })

  it('失败局跳过：sourceCount 只计有效局', async () => {
    mockedDetail.mockImplementation(async (_region, gameId) =>
      gameId === 102 ? null : makeDetail(5)
    )
    const { curve, attempted, load } = scope.run(() => useMinuteCurve(ref(gamesOf(5)), ref(SELF)))!
    await load()
    expect(curve.value!.sourceCount).toBe(4)
    expect(attempted.value).toBe(5)
  })

  it('全部失败 → curve null + error true', async () => {
    mockedDetail.mockResolvedValue(null)
    const { curve, error, load } = scope.run(() => useMinuteCurve(ref(gamesOf(3)), ref(SELF)))!
    await load()
    expect(curve.value).toBeNull()
    expect(error.value).toBe(true)
  })

  it('generation 防串：加载中再次 load 丢弃旧批次', async () => {
    let resolveFirst!: (v: Awaited<ReturnType<typeof mockedDetail>>) => void
    mockedDetail
      .mockImplementationOnce(() => new Promise(r => (resolveFirst = r)))
      .mockResolvedValue(makeDetail(5))
    const { curve, load } = scope.run(() => useMinuteCurve(ref(gamesOf(2)), ref(SELF)))!
    const p1 = load()
    // 第一局挂起期间再次 load：作废 p1 的后续写入
    const p2 = load()
    resolveFirst(makeDetail(5))
    await p2
    await p1
    await nextTick()
    // 第二次 load 的批次最终生效（generation 递增后旧批次写入被丢弃）
    expect(curve.value).not.toBeNull()
  })

  it('reset 清空结果', async () => {
    const { curve, load, reset } = scope.run(() => useMinuteCurve(ref(gamesOf(2)), ref(SELF)))!
    await load()
    expect(curve.value).not.toBeNull()
    reset()
    expect(curve.value).toBeNull()
  })
})
