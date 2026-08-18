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
  computeDualPicks,
  getChampionIntel,
  normalizeLcuPosition,
  positionToOpgg,
  sortCounters,
  sortSynergies,
  type ChampionIntel,
  type CounterItem,
  type CounterSortDir,
  type CounterSortKey,
  type DualPick,
  type SynergyItem,
  type SynergySortDir,
  type SynergySortKey
} from '@renderer/features/gaming/services/counterIntel'
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

/** 排序后的搭档列表（纯函数，弹窗搭档节排序用）。 */
export function sortedSynergies(
  intel: ChampionIntel | null,
  sortKey: SynergySortKey,
  sortDir: SynergySortDir
): SynergyItem[] {
  if (!intel) return []
  return sortSynergies(intel.synergies, sortKey, sortDir)
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
 * 已亮阵容 → 我方候选最优推荐（P2 对位 + P3 协同双维数据源）。
 *
 * 拉取每个敌方已锁英雄（请求数 = |已锁敌方| ≤ 5）与我方已亮队友（≤ 4）的
 * 对位情报（同模块级缓存），用 [`computeDualPicks`] 融合评分排序：对位分
 * （反查敌方 counters）+ 协同分（队友 synergies 命中）。
 *
 * @param enemyIds - 敌方已锁英雄 ID（≤0 过滤）
 * @param candidateIds - 排除 ban/锁定/intent 后的候选英雄 ID（为空则无推荐）
 * @param tier - 段位分段
 * @param region - 区域（默认 "global"）
 * @param teammateIds - 我方已亮队友英雄 ID（含 intent/picking/locked；
 *   为空数组则纯对位推荐，行为与旧版一致）
 * @param myPosition - 我自己本局的 LCU 分路（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY，
 *   空串不过滤）；非空时候选池按 OP.GG 主分路收敛到同位置英雄
 */
export function useBestPicks(
  enemyIds: Ref<number[]>,
  candidateIds: Ref<number[]>,
  tier: Ref<string>,
  region: Ref<string> = ref('global'),
  teammateIds: Ref<number[]> = ref<number[]>([]),
  myPosition: Ref<string> = ref('')
): {
  picks: Ref<DualPick[]>
  isLoading: Ref<boolean>
  error: Ref<boolean>
} {
  const picks = ref<DualPick[]>([])
  const isLoading = ref(false)
  const error = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  /** 英雄主分路缓存：快照 meta 只在会话内稳定，revision 变化后重查 */
  const mainPositionCache = new Map<number, string>()

  const run = async (
    ids: number[],
    candidates: number[],
    t: string,
    r: string,
    teammates: number[],
    myPos: string
  ): Promise<void> => {
    isLoading.value = true
    error.value = false
    try {
      // 每个敌方已锁英雄：快照主分路 → 对位情报
      const enemyIntelById = new Map<number, ChampionIntel>()
      for (const enemyId of ids) {
        const intel = await intelFor(enemyId, t, r)
        if (intel) enemyIntelById.set(enemyId, intel)
      }
      if (disposed) return

      // 每个队友已亮英雄：快照主分路 → 对位情报（synergies 同源返回，供协同分）
      const teammateIntelById = new Map<number, ChampionIntel>()
      for (const teammateId of teammates) {
        const intel = await intelFor(teammateId, t, r)
        if (intel) teammateIntelById.set(teammateId, intel)
      }
      if (disposed) return

      // 位置收敛：仅当我方分路已知时，把候选池过滤到同主分路英雄。
      // 用大小写不敏感的规范化：LCU 下发的是小写，直接 positionToOpgg 会漏判。
      let pool = candidates
      if (myPos) {
        const target = normalizeLcuPosition(myPos)
        if (target) {
          const kept: number[] = []
          for (const c of candidates) {
            const meta = await getChampionMeta('ranked', c)
            if (!meta) continue
            const pos = positionToOpgg(meta.position) ?? ''
            mainPositionCache.set(c, pos)
            if (pos === target) kept.push(c)
          }
          pool = kept
        }
      }

      picks.value = computeDualPicks(pool, enemyIntelById, teammateIntelById)
      error.value = false
    } catch {
      if (disposed) return
      error.value = true
      picks.value = []
    } finally {
      if (!disposed) isLoading.value = false
    }
  }

  /** 单英雄 intel：主分路缓存定位 → 模块级缓存命中或拉取 */
  const intelFor = async (
    championId: number,
    t: string,
    r: string
  ): Promise<ChampionIntel | null> => {
    let pos = mainPositionCache.get(championId)
    if (!pos) {
      const meta = await getChampionMeta('ranked', championId)
      if (!meta) return null // 快照无该英雄：缺席评分（无数据不编造）
      pos = positionToOpgg(meta.position) ?? ''
      mainPositionCache.set(championId, pos)
    }
    if (!pos) return null
    const key = cacheKey(r, championId, pos, t)
    let intel: ChampionIntel | null | undefined = intelCache.get(key)
    if (!intel) {
      intel = await getChampionIntel(r, championId, pos, t)
      if (intel) intelCache.set(key, intel)
    }
    return intel
  }

  watch(
    [enemyIds, candidateIds, tier, region, teammateIds, myPosition, opggRevision],
    async ([ids, candidates, t, r, teammates, myPos, rev]) => {
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
      const validTeammates = teammates.filter(id => id > 0)
      // 敌方与队友均未亮时无推荐（纯协同场景允许"敌方 0 + 队友 ≥1"）
      if ((validIds.length === 0 && validTeammates.length === 0) || candidates.length === 0) {
        picks.value = []
        return
      }
      timer = setTimeout(() => {
        timer = null
        void run(validIds, candidates, t, r, validTeammates, myPos)
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
