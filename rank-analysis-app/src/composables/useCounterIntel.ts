/**
 * 选人期对位情报取数：150ms 防抖 + 模块级缓存 + `opggRevision` 失效。
 *
 * 供两个入口复用：
 * - CounterHover 弹窗：悬浮任意英雄头像 → `useCounterIntel(championId, position)`
 * - BestPicksPanel 推荐：敌方已锁阵容 → `useBestPicks(enemyIds, candidateIds, ...)`
 *
 * 缓存是模块级的（同会话内同一英雄同一位置不重复请求）；`opggRevision` 变化
 * （段位切换）会清空缓存强制重取——数据源变更是服务层的事，见 `services/opgg.ts`。
 */

import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  computeBestPicks,
  getChampionIntel,
  positionToOpgg,
  sortCounters,
  type BestPick,
  type ChampionIntel,
  type CounterItem,
  type CounterSortDir,
  type CounterSortKey
} from '@renderer/services/counterIntel'
import { getChampionMeta, opggRevision } from '@renderer/services/opgg'

/** 防抖窗口：悬浮停顿 150ms 才拉取，避免扫过头像时的请求风暴 */
export const DEBOUNCE_MS = 150

/** 模块级缓存：region|tier|championId|position → intel（同会话内不重复请求） */
const intelCache = new Map<string, ChampionIntel>()

/** 缓存键：与后端 `cache_key` 的字段一致，参数不同互不命中 */
function cacheKey(region: string, championId: number, position: string, tier: string): string {
  return `${region}|${tier}|${championId}|${position}`
}

/** 清空缓存（opggRevision 变化时调用；也供测试重置） */
export function clearCounterIntelCache(): void {
  intelCache.clear()
}

/** 排序后的对位列表（纯函数，弹窗表头切换用）。 */
export function sortedCounters(
  intel: ChampionIntel | null,
  sortKey: CounterSortKey,
  sortDir: CounterSortDir
): CounterItem[] {
  if (!intel) return []
  return sortCounters(intel.counters, sortKey, sortDir)
}

/**
 * 单英雄对位情报（P1 弹窗数据源）。
 *
 * 输入变化（championId / position / tier / region / opggRevision）时防抖 150ms 取数；
 * 缓存命中直接回显不发请求。组件卸载时未触发的防抖定时器被清理。
 *
 * @param championId - 英雄 ID（≤0 时不发请求，intel 恒 null）
 * @param position - LCU 分路命名（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY；空串不发请求）
 * @param tier - 段位分段（如 "emerald_plus"，一般来自 useOpggTier）
 * @param region - 区域（默认 "global"）
 */
export function useCounterIntel(
  championId: Ref<number>,
  position: Ref<string>,
  tier: Ref<string>,
  region: Ref<string> = ref('global')
): {
  intel: Ref<ChampionIntel | null>
  isLoading: Ref<boolean>
  error: Ref<boolean>
} {
  const intel = ref<ChampionIntel | null>(null)
  const isLoading = ref(false)
  const error = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const run = async (id: number, pos: string, t: string, r: string): Promise<void> => {
    if (disposed) return
    isLoading.value = true
    error.value = false
    let fetched: ChampionIntel | null = null
    try {
      fetched = await getChampionIntel(r, id, pos, t)
    } catch {
      // service 层已做容错，这里再兜一层：任何异常都走降级而不是抛出
      fetched = null
    }
    if (disposed) return
    if (fetched) intelCache.set(cacheKey(r, id, pos, t), fetched)
    intel.value = fetched
    error.value = fetched === null
    isLoading.value = false
  }

  watch(
    [championId, position, tier, region, opggRevision],
    async ([id, pos, t, r, rev]) => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      // 段位切换：清缓存 + 丢弃旧数据（防止旧段位命中被缓存回显）
      if (rev !== lastRevision) {
        lastRevision = rev
        clearCounterIntelCache()
        intel.value = null
      }
      if (id <= 0 || !pos) {
        intel.value = null
        return
      }
      const key = cacheKey(r, id, pos, t)
      // 命中缓存：直接回显（不触发 loading，避免闪烁）
      const cached = intelCache.get(key)
      if (cached) {
        intel.value = cached
        error.value = false
        return
      }
      timer = setTimeout(() => {
        timer = null
        void run(id, pos, t, r)
      }, DEBOUNCE_MS)
    },
    { immediate: true }
  )

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      if (timer) clearTimeout(timer)
    })
  }

  return { intel, isLoading, error }
}

/** 上一次生效的 opggRevision（模块级，useCounterIntel / useBestPicks 共用） */
let lastRevision = opggRevision.value

/**
 * 敌方已锁阵容 → 我方候选最优推荐（P2 数据源）。
 *
 * 拉取每个敌方已锁英雄的对位情报（请求数 = |已锁敌方| ≤ 5，候选池不增加请求），
 * 用 [`computeBestPicks`] 对候选评分排序。敌方英雄位置取快照主分路（敌方
 * assignedPosition 恒空，主分路是唯一可靠近似）。
 *
 * @param enemyIds - 敌方已锁英雄 ID（≤0 过滤）
 * @param candidateIds - 排除 ban/锁定/intent 后的候选英雄 ID（为空则无推荐）
 * @param tier - 段位分段
 * @param region - 区域（默认 "global"）
 */
export function useBestPicks(
  enemyIds: Ref<number[]>,
  candidateIds: Ref<number[]>,
  tier: Ref<string>,
  region: Ref<string> = ref('global')
): {
  picks: Ref<BestPick[]>
  isLoading: Ref<boolean>
  error: Ref<boolean>
} {
  const picks = ref<BestPick[]>([])
  const isLoading = ref(false)
  const error = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  /** 敌方英雄主分路缓存：快照 meta 只在会话内稳定，revision 变化后重查 */
  const mainPositionCache = new Map<number, string>()

  const run = async (ids: number[], candidates: number[], t: string, r: string): Promise<void> => {
    isLoading.value = true
    error.value = false
    try {
      // 每个敌方已锁英雄：快照主分路 → 对位情报
      const enemyIntelById = new Map<number, ChampionIntel>()
      for (const enemyId of ids) {
        let pos = mainPositionCache.get(enemyId)
        if (!pos) {
          const meta = await getChampionMeta('ranked', enemyId)
          if (!meta) continue // 快照无该英雄：整队缺席评分（无数据不编造）
          pos = positionToOpgg(meta.position) ?? ''
          mainPositionCache.set(enemyId, pos)
        }
        if (!pos) continue
        const key = cacheKey(r, enemyId, pos, t)
        let intel: ChampionIntel | null | undefined = intelCache.get(key)
        if (!intel) {
          intel = await getChampionIntel(r, enemyId, pos, t)
          if (intel) intelCache.set(key, intel)
        }
        if (intel) enemyIntelById.set(enemyId, intel)
      }
      if (disposed) return
      picks.value = computeBestPicks(candidates, enemyIntelById)
      error.value = false
    } catch {
      if (disposed) return
      error.value = true
      picks.value = []
    } finally {
      if (!disposed) isLoading.value = false
    }
  }

  watch(
    [enemyIds, candidateIds, tier, region, opggRevision],
    async ([ids, candidates, t, r, rev]) => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (rev !== lastRevision) {
        lastRevision = rev
        clearCounterIntelCache()
        mainPositionCache.clear()
      }
      const validIds = ids.filter(id => id > 0)
      if (validIds.length === 0 || candidates.length === 0) {
        picks.value = []
        return
      }
      timer = setTimeout(() => {
        timer = null
        void run(validIds, candidates, t, r)
      }, DEBOUNCE_MS)
    },
    { immediate: true }
  )

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      if (timer) clearTimeout(timer)
    })
  }

  return { picks, isLoading, error }
}
