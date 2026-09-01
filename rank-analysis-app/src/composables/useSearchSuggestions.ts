/**
 * Header 超级搜索的候选聚合
 *
 * 三个本地数据源(全部毫秒级,不打网络):
 * - 好友列表(get_friends,首次有输入时懒加载一次,失败静默降级)
 * - 备注玩家(usePlayerNotesStore.list)
 * - 搜索历史(localStorage,精确查人成功后写入)
 *
 * 纯函数(isRiotIdLike / buildPlayerSuggestions / 历史读写)单独导出便于测试,
 * composable 只做数据源接线。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'

/** 单条玩家候选 */
export interface PlayerSuggestion {
  /** 完整 Riot ID:名字#tag */
  name: string
  /** 历史来源可携带当时的大区(platformId),其余来源为空 = 当前区 */
  region?: string
  source: 'friend' | 'note' | 'history'
}

/** 每个来源最多展示的候选数 */
const MAX_PER_SOURCE = 4

/**
 * 输入是否形似 Riot ID:恰好一个 `#`,号前有名字、号后有非空白 tag。
 * gameName 可含空格,不能按空格判断。
 */
export function isRiotIdLike(input: string): boolean {
  const s = input.trim()
  const first = s.indexOf('#')
  if (first <= 0 || first !== s.lastIndexOf('#')) return false
  return /\S/.test(s.slice(first + 1))
}

/**
 * 聚合三个来源的候选:大小写不敏感子串匹配、跨来源按名字去重
 * (好友 > 备注 > 历史)、每来源截断到 {@link MAX_PER_SOURCE}。
 * @param input - 当前输入(空串 = 不过滤,用于展示默认候选)
 */
export function buildPlayerSuggestions(
  input: string,
  sources: {
    friends: PlayerSuggestion[]
    notes: PlayerSuggestion[]
    history: PlayerSuggestion[]
  }
): PlayerSuggestion[] {
  const needle = input.trim().toLowerCase()
  const seen = new Set<string>()
  const out: PlayerSuggestion[] = []

  for (const group of [sources.friends, sources.notes, sources.history]) {
    let taken = 0
    for (const s of group) {
      if (taken >= MAX_PER_SOURCE) break
      const key = s.name.toLowerCase()
      if (seen.has(key)) continue
      if (needle && !key.includes(needle)) continue
      seen.add(key)
      out.push(s)
      taken++
    }
  }
  return out
}

// ─── 搜索历史(localStorage) ─────────────────────────────────────────────────

const HISTORY_KEY = 'searchHistory.v1'
const HISTORY_LIMIT = 20

export interface SearchHistoryEntry {
  name: string
  region: string
  ts: number
}

/** 读取搜索历史(最近在前);存储缺失/损坏返回空数组 */
export function loadSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is SearchHistoryEntry => typeof e?.name === 'string' && typeof e?.region === 'string'
    )
  } catch {
    return []
  }
}

/** 记录一次成功的精确查人(name+region 去重提升到最前,上限 20) */
export function pushSearchHistory(name: string, region: string): void {
  try {
    const rest = loadSearchHistory().filter(e => !(e.name === name && e.region === region))
    const next = [{ name, region, ts: Date.now() }, ...rest].slice(0, HISTORY_LIMIT)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用(隐私模式等)时静默放弃,搜索功能本身不受影响
  }
}

// ─── composable ──────────────────────────────────────────────────────────────

interface FriendLite {
  gameName: string
  tagLine: string
  puuid: string
}

/**
 * 组件侧候选接线:输入 ref → 响应式候选列表 + Riot ID 判定
 * @param input - 搜索框输入
 */
export function useSearchSuggestions(input: Ref<string>): {
  playerSuggestions: ComputedRef<PlayerSuggestion[]>
  riotIdLike: ComputedRef<boolean>
} {
  const notesStore = usePlayerNotesStore()
  const friends = ref<PlayerSuggestion[]>([])

  // 好友列表懒加载:首次出现非空输入时拉一次;LCU 未连接等失败静默(无好友组)
  let friendsLoaded = false
  watch(
    input,
    async v => {
      if (friendsLoaded || !v.trim()) return
      friendsLoaded = true
      try {
        const list = await invoke<FriendLite[]>('get_friends')
        friends.value = list
          .filter(f => f.gameName && f.tagLine)
          .map(f => ({ name: `${f.gameName}#${f.tagLine}`, source: 'friend' as const }))
      } catch (e) {
        console.warn('[SuperSearch] 好友列表加载失败(候选降级):', e)
      }
    },
    { immediate: true }
  )

  const noteSuggestions = computed<PlayerSuggestion[]>(() =>
    notesStore.list
      .filter(n => n.gameName && n.tagLine)
      .map(n => ({ name: `${n.gameName}#${n.tagLine}`, source: 'note' as const }))
  )

  const historySuggestions = computed<PlayerSuggestion[]>(() =>
    // input 变化时重读:pushSearchHistory 写的是 localStorage,没有响应式信号
    input.value !== undefined
      ? loadSearchHistory().map(h => ({
          name: h.name,
          region: h.region || undefined,
          source: 'history' as const
        }))
      : []
  )

  const playerSuggestions = computed(() =>
    buildPlayerSuggestions(input.value, {
      friends: friends.value,
      notes: noteSuggestions.value,
      history: historySuggestions.value
    })
  )

  const riotIdLike = computed(() => isRiotIdLike(input.value))

  return { playerSuggestions, riotIdLike }
}
