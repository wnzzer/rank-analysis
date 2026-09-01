/**
 * Header 超级搜索的候选聚合
 *
 * 四个本地数据源:
 * - 好友列表(get_friends,首次有输入时懒加载一次,失败静默降级)
 * - 备注玩家(usePlayerNotesStore.list)
 * - 搜索历史(localStorage,精确查人确认成功后写入)
 * - 近期对局同场过的玩家(get_match_history_by_puuid 近 20 局派生,懒加载)
 *
 * 纯函数(isRiotIdLike / buildPlayerSuggestions / 历史读写)单独导出便于测试,
 * composable 只做数据源接线。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'
import type { Game, MatchHistory } from '@renderer/types/domain/match'

/** 单条玩家候选 */
export interface PlayerSuggestion {
  /** 完整 Riot ID:名字#tag */
  name: string
  /** 历史来源可携带当时的大区(platformId),其余来源为空 = 当前区 */
  region?: string
  source: 'friend' | 'note' | 'history' | 'played'
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
 * 聚合各来源的候选:大小写不敏感子串匹配、跨来源按名字去重
 * (好友 > 备注 > 历史 > 对局过)、每来源截断到 {@link MAX_PER_SOURCE}。
 * @param input - 当前输入(空串 = 不过滤,用于展示默认候选)
 */
export function buildPlayerSuggestions(
  input: string,
  sources: {
    friends: PlayerSuggestion[]
    notes: PlayerSuggestion[]
    history: PlayerSuggestion[]
    /** 近期对局里同场过的玩家(可选来源) */
    played?: PlayerSuggestion[]
  }
): PlayerSuggestion[] {
  const needle = input.trim().toLowerCase()
  const seen = new Set<string>()
  const out: PlayerSuggestion[] = []

  for (const group of [sources.friends, sources.notes, sources.history, sources.played ?? []]) {
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

/**
 * 记录一次「确认成功」的精确查人(spec:搜索历史只存成功的搜索)。
 * - 候选行/跨区搜索:玩家已知或无法便宜验证,直接写入
 * - 当前区手输名字:先验证召唤师存在(get_summoner_by_name 有 Rust 侧缓存,
 *   Record 页随后的同名查询会命中缓存,不算额外开销),不存在则不污染历史
 */
export async function recordSearchHistory(
  name: string,
  region: string,
  opts: { known?: boolean } = {}
): Promise<void> {
  if (opts.known || region) {
    pushSearchHistory(name, region)
    return
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('get_summoner_by_name', { name })
    pushSearchHistory(name, region)
  } catch {
    // 召唤师不存在/LCU 不可用:不写历史,搜索本身的失败由 Record 页展示
  }
}

/**
 * 从近期对局提取同场过的玩家(排除自己与无名条目,按出现顺序去重)
 * @param games - 近期对局(需已带 gameDetail.participantIdentities)
 * @param myPuuid - 当前玩家 puuid
 */
export function extractRecentPlayers(games: Game[], myPuuid: string): PlayerSuggestion[] {
  const seen = new Set<string>()
  const out: PlayerSuggestion[] = []
  for (const g of games) {
    for (const idn of g.gameDetail?.participantIdentities ?? []) {
      const p = idn.player
      if (!p?.gameName || !p.tagLine || p.puuid === myPuuid) continue
      const name = `${p.gameName}#${p.tagLine}`
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, source: 'played' })
    }
  }
  return out
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
  const played = ref<PlayerSuggestion[]>([])

  // 好友与近期同场玩家懒加载:首次出现非空输入时各拉一次;失败静默(该来源为空)
  let lazyLoaded = false
  watch(
    input,
    v => {
      if (lazyLoaded || !v.trim()) return
      lazyLoaded = true
      invoke<FriendLite[]>('get_friends')
        .then(list => {
          friends.value = list
            .filter(f => f.gameName && f.tagLine)
            .map(f => ({ name: `${f.gameName}#${f.tagLine}`, source: 'friend' as const }))
        })
        .catch(e => console.warn('[SuperSearch] 好友列表加载失败(候选降级):', e))
      invoke<FriendLite>('get_my_summoner')
        .then(me =>
          invoke<MatchHistory>('get_match_history_by_puuid', {
            puuid: me.puuid,
            begIndex: 0,
            endIndex: 19
          }).then(h => {
            played.value = extractRecentPlayers((h.games?.games ?? []) as Game[], me.puuid)
          })
        )
        .catch(e => console.warn('[SuperSearch] 近期同场玩家加载失败(候选降级):', e))
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
      history: historySuggestions.value,
      played: played.value
    })
  )

  const riotIdLike = computed(() => isRiotIdLike(input.value))

  return { playerSuggestions, riotIdLike }
}
