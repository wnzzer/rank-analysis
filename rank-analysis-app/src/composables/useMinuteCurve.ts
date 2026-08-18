/**
 * D-P3 分时曲线取数：按需（用户展开才拉）串行拉取近 N 场 SGP 详情 → 场均分钟曲线。
 *
 * - 复用 `getSgpMatchDetail` 的局级缓存（详情页展开过的局零新增请求）
 * - 串行拉取（每场 1 请求，最多 limit 场），任一局失败只跳过（sourceCount 计有效局）
 * - generation 防串：切换玩家/重复展开时作废进行中的旧批次，结果不串台
 *
 * @module composables/useMinuteCurve
 */

import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import {
  aggregateMinuteCurves,
  buildGameMinuteCurve,
  type AggregatedMinuteCurve
} from '@renderer/components/record/minuteCurve'
import { getSgpMatchDetail } from '@renderer/features/record/services/sgp'

/** 曲线样本上限：近 10 场平均（20 场 × 详情请求过重，10 场足够看趋势） */
export const MINUTE_CURVE_LIMIT = 10

/** 单局来源（Game 的子集，解耦避免依赖完整战绩结构） */
export interface CurveGameSource {
  gameId: number
  platformId: string
}

export interface UseMinuteCurve {
  curve: Ref<AggregatedMinuteCurve | null>
  loading: Ref<boolean>
  /** 有效样本场数（聚合口径 = curve?.sourceCount） */
  error: Ref<boolean>
  /** 本轮尝试拉取的场数（含失败/跳过） */
  attempted: Ref<number>
  /** 触发拉取（幂等：loading 中重复调用直接返回；已就绪且输入未变返回已有结果） */
  load: () => Promise<AggregatedMinuteCurve | null>
  /** 清空结果（切换玩家 / 输入变化时由调用方决定是否保留缓存态） */
  reset: () => void
}

/** 输入快照：游戏列表（时间降序，取前 limit 场）+ 本人 puuid */
function snapshot(games: CurveGameSource[], myPuuid: string, limit: number) {
  return {
    games: games.slice(0, limit),
    myPuuid
  }
}

export function useMinuteCurve(
  games: Ref<CurveGameSource[]>,
  myPuuid: Ref<string>,
  limit: number = MINUTE_CURVE_LIMIT
): UseMinuteCurve {
  const curve = ref<AggregatedMinuteCurve | null>(null)
  const loading = ref(false)
  const error = ref(false)
  const attempted = ref(0)

  let generation = 0
  let disposed = false

  async function run(snap: {
    games: CurveGameSource[]
    myPuuid: string
  }): Promise<AggregatedMinuteCurve | null> {
    if (snap.games.length === 0 || !snap.myPuuid) {
      curve.value = null
      attempted.value = 0
      error.value = false
      loading.value = false
      return null
    }
    loading.value = true
    error.value = false
    const curves: ReturnType<typeof buildGameMinuteCurve>[] = []
    let tried = 0
    const myGen = generation
    // 串行：每场一个请求，避免并发打爆；失败场次跳过（数据缺失是常态降级）
    for (const g of snap.games) {
      if (disposed || myGen !== generation) return null
      tried++
      const resp = await getSgpMatchDetail(g.platformId, g.gameId)
      if (disposed || myGen !== generation) return null
      curves.push(resp ? buildGameMinuteCurve(resp.json ?? null, snap.myPuuid) : null)
    }
    if (disposed || myGen !== generation) return null
    attempted.value = tried
    const agg = aggregateMinuteCurves(curves)
    curve.value = agg
    error.value = agg === null
    loading.value = false
    return agg
  }

  async function load(): Promise<AggregatedMinuteCurve | null> {
    if (loading.value) return null
    generation++
    return run(snapshot(games.value, myPuuid.value, limit))
  }

  function reset(): void {
    generation++
    curve.value = null
    attempted.value = 0
    error.value = false
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      generation++
    })
  }

  return { curve, loading, error, attempted, load, reset }
}
