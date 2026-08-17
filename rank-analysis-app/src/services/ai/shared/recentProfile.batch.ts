/**
 * 10 人并发拉取近期对局 + 聚合 + 模块级 LRU 缓存。
 *
 * - 并发：Promise.all
 * - 单失败：该 puuid profile=null（不阻塞其他）
 * - 缓存：内存 Map<puuid, {profile, expireAt}>，TTL 10 分钟
 */

import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { getSgpMatchHistoryByName } from '@renderer/services/sgp'
import { buildRecentProfile, type RecentGameRaw } from './recentProfile'
import { buildNoteBrief } from './noteBrief'
import type { RecentPlayerProfile, TeamPosition } from './types'

const CACHE_TTL_MS = 10 * 60 * 1000
/**
 * 缓存 key = `puuid:championId`——profile 的 currentChampionMastery 依赖请求时的
 * 当前英雄（championId），选人期玩家换英雄锁定后旧 mastery 必须失效。
 */
const CACHE = new Map<string, { profile: RecentPlayerProfile; expireAt: number }>()

function cacheKey(req: ProfileRequest): string {
  return `${req.puuid}:${req.championId}`
}

interface RawHistoryResponse {
  games?: { games?: RawMatch[] }
}

interface RawMatch {
  participants: RawParticipant[]
  participantIdentities: Array<{
    participantId: number
    player: { puuid: string }
  }>
}

interface RawParticipant {
  participantId: number
  championId: number
  teamPosition?: string
  stats: {
    win: boolean
    kills: number
    deaths: number
    assists: number
  }
}

export interface ProfileRequest {
  puuid: string
  teamPosition: TeamPosition
  championId: number
  /**
   * 跨区来源（SGP fallback 用）：目标大区 platformId（如 `HN10`）。缺省时
   * 无法定位玩家所在大区（SGP 战绩按大区分存），跨区画像 fallback 不启用。
   */
  region?: string
  /** 玩家名字#TAG（SGP fallback 用，按名字解析全局 puuid 后拉战绩） */
  name?: string
}

export type ProfileMap = Map<string, RecentPlayerProfile | null>

export async function fetchBatchProfiles(requests: ProfileRequest[]): Promise<ProfileMap> {
  const result: ProfileMap = new Map()

  // Partition: cache hits vs misses
  const toFetch: ProfileRequest[] = []
  const now = Date.now()
  for (const req of requests) {
    const cached = CACHE.get(cacheKey(req))
    if (cached && cached.expireAt > now) {
      result.set(req.puuid, cached.profile)
    } else {
      toFetch.push(req)
    }
  }

  // Concurrent fetch
  const fetched = await Promise.all(toFetch.map(req => fetchSingleProfile(req)))

  for (let i = 0; i < toFetch.length; i++) {
    const req = toFetch[i]
    const profile = fetched[i]
    result.set(req.puuid, profile)
    if (profile !== null) {
      CACHE.set(cacheKey(req), { profile, expireAt: now + CACHE_TTL_MS })
    }
  }

  return result
}

/**
 * 按隐私开关向 profile map 注入使用者手动备注
 *
 * 每次调用时实时读取 `aiUsePlayerNotes` 开关（键不存在视为开）——
 * **结果不可缓存**：任何缓存层（模块级 LRU、per-game 缓存等）都只能存
 * 本函数注入前的"干净" map，并在每次使用前重新调用本函数，
 * 否则开关切换 / 备注变更在缓存生效期内不会生效（隐私旁路）。
 *
 * @param profileMap - fetchBatchProfiles 返回的干净 profile map（不会被就地修改）
 * @returns 开关关闭时原样返回入参；开启时返回新 map，
 *          有备注的 profile 为注入 `note` 的浅拷贝（无备注不加字段）
 */
export async function injectNoteBriefs(profileMap: ProfileMap): Promise<ProfileMap> {
  const useNotes = (await getConfigByIpc<boolean>(CONFIG_KEYS.aiUsePlayerNotes)) !== false
  if (!useNotes) return profileMap

  const result: ProfileMap = new Map()
  for (const [puuid, profile] of profileMap) {
    const brief = profile ? buildNoteBrief(puuid) : undefined
    result.set(puuid, brief && profile ? { ...profile, note: brief } : profile)
  }
  return result
}

async function fetchSingleProfile(req: ProfileRequest): Promise<RecentPlayerProfile | null> {
  try {
    const resp = await invoke<RawHistoryResponse>('get_match_history_by_puuid', {
      puuid: req.puuid,
      begIndex: 0,
      endIndex: 19
    })
    const matches = resp?.games?.games ?? []
    const recentGames: RecentGameRaw[] = matches
      .map(m => rawMatchToRecentGame(m, req.puuid))
      .filter((g): g is RecentGameRaw => g !== null)

    // 本区无战绩（跨区玩家/新号）且调用方给了大区上下文时，走 SGP 战绩兜底：
    // SGP 战绩按大区分存，必须知道目标大区才能查；无 region 时保持现语义
    // （返回全空画像，不编造任何数字）。
    if (recentGames.length === 0 && req.region && req.name) {
      return fetchSgpProfile(req)
    }

    return buildRecentProfile({
      currentTeamPosition: req.teamPosition,
      currentChampionId: req.championId,
      recentGames
    })
  } catch (err) {
    console.warn(`recentProfile fetch failed for ${req.puuid}`, err)
    return null
  }
}

/**
 * SGP 跨区战绩兜底：按「名字#TAG」在目标大区拉近期对局并聚合。
 *
 * Rust 侧 `map_sgp_to_match_history` 会把被查玩家排到每局 `participants[0]`；
 * SGP 是 match-v5 扁平结构，天然带 `timeline.lane`（比 LCU 摘要更全的分路数据）。
 * 失败返回 null（调用方按「无数据」降级，不阻塞其他玩家）。
 */
async function fetchSgpProfile(req: ProfileRequest): Promise<RecentPlayerProfile | null> {
  try {
    const mh = await getSgpMatchHistoryByName(req.region ?? '', req.name ?? '', 0, 19)
    const games = mh?.games?.games ?? []
    const recentGames: RecentGameRaw[] = games
      .map(g => sgpGameToRecentGame(g))
      .filter((g): g is RecentGameRaw => g !== null)

    return buildRecentProfile({
      currentTeamPosition: req.teamPosition,
      currentChampionId: req.championId,
      recentGames
    })
  } catch (err) {
    console.warn(`recentProfile SGP fallback failed for ${req.puuid}`, err)
    return null
  }
}

/** SGP 对局 → 画像聚合原始行（被查玩家在 participants[0]，Rust 侧已排序） */
function sgpGameToRecentGame(g: RawSgpGame): RecentGameRaw | null {
  const p = g.gameDetail?.participants?.[0]
  if (!p) return null
  const timeline = (p as unknown as { timeline?: { lane?: string } }).timeline
  return {
    teamPosition: timeline?.lane ?? '',
    championId: p.championId,
    win: p.stats?.win ?? false,
    kills: p.stats?.kills ?? 0,
    deaths: p.stats?.deaths ?? 0,
    assists: p.stats?.assists ?? 0
  }
}

function rawMatchToRecentGame(m: RawMatch, puuid: string): RecentGameRaw | null {
  const identity = m.participantIdentities?.find(i => i.player.puuid === puuid)
  if (!identity) return null
  const participant = m.participants?.find(p => p.participantId === identity.participantId)
  if (!participant) return null
  return {
    teamPosition: participant.teamPosition ?? '',
    championId: participant.championId,
    win: participant.stats.win,
    kills: participant.stats.kills,
    deaths: participant.stats.deaths,
    assists: participant.stats.assists
  }
}

/** SGP 对局的最小形状（复用现有 MatchHistory 结构，只声明画像用到的字段） */
type RawSgpGame = {
  gameDetail?: {
    participants?: Array<{
      participantId: number
      championId: number
      stats?: { win?: boolean; kills?: number; deaths?: number; assists?: number }
    }>
  }
}

/** Test-only: clears the LRU cache. */
export function __resetCacheForTests(): void {
  CACHE.clear()
}

/**
 * 单玩家画像查询（hover 画像卡用）：走批量链路的 LRU 缓存 + 备注注入。
 *
 * 与批量入口的差异：上下文（本局位置/英雄）可缺省——hover 场景不要求
 * 知道「他这场打什么位置」，此时位置分布照常聚合，但补位判定不生效。
 *
 * @param query - puuid 必填；teamPosition/championId 缺省时按「无上下文」处理
 * @returns 画像（含手动备注注入）；拉取失败/无数据返回 null
 */
export async function fetchPlayerProfile(query: {
  puuid: string
  teamPosition?: TeamPosition
  championId?: number
  /** 跨区大区 platformId：本区无战绩时走 SGP 战绩兜底（需配合 name） */
  region?: string
  /** 玩家名字#TAG：SGP 兜底按名字解析全局 puuid */
  name?: string
}): Promise<RecentPlayerProfile | null> {
  const req: ProfileRequest = {
    puuid: query.puuid,
    teamPosition: query.teamPosition ?? 'UNKNOWN',
    championId: query.championId ?? 0,
    region: query.region,
    name: query.name
  }
  const map = await fetchBatchProfiles([req])
  const profile = map.get(query.puuid) ?? null
  if (profile === null) return null
  const withNotes = await injectNoteBriefs(new Map([[query.puuid, profile]]))
  return withNotes.get(query.puuid) ?? profile
}
