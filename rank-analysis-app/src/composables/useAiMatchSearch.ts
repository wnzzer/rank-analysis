/**
 * AI 搜战绩的编排状态机(Record 页 AiSearchResults 使用)
 *
 * run(text) 驱动:parsing(qwen 解析)→ fetching(SGP 分页拉取)→ done。
 * 拉到的原始对局保留在内存,删 chip 只做本地重筛,不重打模型/网络。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { parseMatchQuery } from '@renderer/services/ai/matchSearch/parse'
import { fetchGamesForQuery, type FetchProgress } from '@renderer/services/ai/matchSearch/fetch'
import { filterGames, countEncounters } from '@renderer/services/ai/matchSearch/filter'
import { queryToChips, removeChipFromQuery } from '@renderer/services/ai/matchSearch/chips'
import type {
  ParsedMatchQuery,
  EncounterStats,
  QueryChip
} from '@renderer/services/ai/matchSearch/types'
import { loadChampionNames, getChampionName } from '@renderer/services/ai/champion-names'
import { modeOptions } from '@renderer/composables/useGameModes'
import type { Game } from '@renderer/types/domain/match'

export type AiSearchPhase = 'idle' | 'parsing' | 'fetching' | 'done' | 'error'

/** 搜索结果的元信息(数据源/是否截断/实际搜索局数,供结果区说明) */
export interface AiSearchMeta {
  source: 'sgp' | 'lcu'
  truncated: boolean
  searchedCount: number
}

export function useAiMatchSearch(): {
  phase: Ref<AiSearchPhase>
  error: Ref<string>
  progress: Ref<FetchProgress>
  query: Ref<ParsedMatchQuery | null>
  chips: ComputedRef<QueryChip[]>
  results: Ref<Game[]>
  encounterStats: Ref<EncounterStats | null>
  meta: Ref<AiSearchMeta | null>
  run(text: string): Promise<void>
  removeChip(key: string): void
} {
  const phase = ref<AiSearchPhase>('idle')
  const error = ref('')
  const progress = ref<FetchProgress>({ fetched: 0, oldestDate: null })
  const query = ref<ParsedMatchQuery | null>(null)
  const results = ref<Game[]>([])
  const encounterStats = ref<EncounterStats | null>(null)
  const meta = ref<AiSearchMeta | null>(null)

  /** 拉取到的原始对局(筛选前),供删 chip 后本地重筛 */
  let rawGames: Game[] = []

  const queueName = (id: number): string =>
    modeOptions.value.find(m => m.value === id)?.label ?? `队列${id}`

  const chips = computed<QueryChip[]>(() =>
    query.value ? queryToChips(query.value, getChampionName, queueName) : []
  )

  /** 按当前 query 对 rawGames 重算结果(list 与 count 两种意图) */
  function applyFilter(): void {
    const q = query.value
    if (!q) return
    if (q.intent === 'count_encounters' && q.playerNames.length > 0) {
      const { stats, games } = countEncounters(rawGames, q)
      encounterStats.value = stats
      results.value = games
    } else {
      encounterStats.value = null
      results.value = filterGames(rawGames, q)
    }
  }

  async function run(text: string): Promise<void> {
    phase.value = 'parsing'
    error.value = ''
    progress.value = { fetched: 0, oldestDate: null }
    results.value = []
    encounterStats.value = null
    meta.value = null

    try {
      // 英雄名与解析并行加载:chips computed 不依赖名字表的响应式,
      // 必须保证 query 赋值(触发 chips 首次渲染)前名字表已就绪
      const [parsed] = await Promise.all([parseMatchQuery(text), loadChampionNames()])
      query.value = parsed
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      phase.value = 'error'
      return
    }

    phase.value = 'fetching'
    try {
      const fetched = await fetchGamesForQuery(query.value, p => {
        progress.value = p
      })
      rawGames = fetched.games
      meta.value = {
        source: fetched.source,
        truncated: fetched.truncated,
        searchedCount: fetched.games.length
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      phase.value = 'error'
      return
    }

    applyFilter()
    phase.value = 'done'
  }

  function removeChip(key: string): void {
    if (!query.value) return
    query.value = removeChipFromQuery(query.value, key)
    applyFilter()
  }

  return {
    phase,
    error,
    progress,
    query,
    chips,
    results,
    encounterStats,
    meta,
    run,
    removeChip
  }
}
