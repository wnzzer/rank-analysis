/**
 * 10 人并发拉取近期对局 + 聚合 + 模块级 LRU 缓存。
 *
 * - 并发：Promise.all
 * - 单失败：该 puuid profile=null（不阻塞其他）
 * - 缓存：内存 Map<puuid, {profile, expireAt}>，TTL 10 分钟
 */

import { invoke } from '@tauri-apps/api/core'
import { buildRecentProfile, type RecentGameRaw } from './recentProfile'
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
