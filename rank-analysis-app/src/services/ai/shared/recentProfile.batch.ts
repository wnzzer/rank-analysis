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
import { buildRecentProfile, type RecentGameRaw } from './recentProfile'
import { buildNoteBrief } from './noteBrief'
import type { RecentPlayerProfile, TeamPosition } from './types'

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE = new Map<string, { profile: RecentPlayerProfile; expireAt: number }>()

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
}

export type ProfileMap = Map<string, RecentPlayerProfile | null>

export async function fetchBatchProfiles(requests: ProfileRequest[]): Promise<ProfileMap> {
  const result: ProfileMap = new Map()

  // Partition: cache hits vs misses
  const toFetch: ProfileRequest[] = []
  const now = Date.now()
  for (const req of requests) {
    const cached = CACHE.get(req.puuid)
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
      CACHE.set(req.puuid, { profile, expireAt: now + CACHE_TTL_MS })
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

/** Test-only: clears the LRU cache. */
export function __resetCacheForTests(): void {
  CACHE.clear()
}
