/**
 * AI 标签建议的输入特征提取：把 LCU 对局原始数据压成喂给 AI 的精简结构。
 *
 * 字段从 7 扩到 15+：新增 cs / killParticipation / damageShare /
 * damageTakenShare / wardScore / multiKillsMax / dpm / gpm / csm / lane /
 * teamPosition。teamPosition 为 NONE/空时走 positionInfer 兜底。
 */

import { inferTeamPosition } from '@renderer/services/ai/shared/positionInfer'
import type { TeamPosition } from '@renderer/services/ai/shared/types'

const KNOWN_RANKED: ReadonlySet<number> = new Set([420, 440])
const KNOWN_MATCHMAKING: ReadonlySet<number> = new Set([430, 480, 490])

export type QueueNameMap = Record<number, string>

export function queueIdToName(id: number, nameMap?: QueueNameMap): string {
  if (nameMap?.[id]) return nameMap[id]
  if (KNOWN_RANKED.has(id)) return '排位模式'
  if (KNOWN_MATCHMAKING.has(id)) return '匹配模式'
  return '娱乐模式'
}

export interface GameFeature {
  // ─── 现有字段 ───
  win: boolean
  championId: number
  queueId: number
  queueName: string
  durationMin: number
  kda: { k: number; d: number; a: number; ratio: number }
  damage: number
  gold: number

  // ─── 新增 基础 ───
  cs: number
  killParticipation: number
  damageShare: number
  damageTakenShare: number
  wardScore: number
  multiKillsMax: 0 | 2 | 3 | 4 | 5

  // ─── 新增 每分钟 ───
  dpm: number
  gpm: number
  csm: number

  // ─── 新增 位置 / 角色 ───
  lane: string
  teamPosition: TeamPosition
}

interface RawParticipantStats {
  win?: boolean
  kills?: number
  deaths?: number
  assists?: number
  totalDamageDealtToChampions?: number
  totalDamageTaken?: number
  goldEarned?: number
  totalMinionsKilled?: number
  neutralMinionsKilled?: number
  visionScore?: number
  doubleKills?: number
  tripleKills?: number
  quadraKills?: number
  pentaKills?: number
}

interface RawParticipant {
  championId?: number
  teamId?: number
  teamPosition?: string
  spell1Id?: number
  spell2Id?: number
  stats?: RawParticipantStats
  timeline?: { lane?: string; role?: string }
}

interface RawIdentity {
  player?: { puuid?: string }
}

export interface RawGame {
  gameId: number
  queueId: number
  gameDuration: number // seconds
  participants: RawParticipant[]
  participantIdentities: RawIdentity[]
}

function safePerMinute(value: number, durationSec: number): number {
  if (durationSec <= 0) return 0
  // 2-decimal precision so csm = 200/30 ≈ 6.67 passes toBeCloseTo(..., 2)
  return Math.round((value / (durationSec / 60)) * 100) / 100
}

function pickMultiKillsMax(s: RawParticipantStats): 0 | 2 | 3 | 4 | 5 {
  if ((s.pentaKills ?? 0) > 0) return 5
  if ((s.quadraKills ?? 0) > 0) return 4
  if ((s.tripleKills ?? 0) > 0) return 3
  if ((s.doubleKills ?? 0) > 0) return 2
  return 0
}

export function gameToFeature(
  game: RawGame,
  myPuuid: string,
  nameMap?: QueueNameMap
): GameFeature | null {
  const idx = game.participantIdentities.findIndex(i => i.player?.puuid === myPuuid)
  if (idx < 0) return null
  const me = game.participants[idx]
  if (!me) return null
  const s = me.stats ?? {}

  const k = s.kills ?? 0
  const d = s.deaths ?? 0
  const a = s.assists ?? 0
  const dForRatio = d === 0 ? 1 : d

  const cs = (s.totalMinionsKilled ?? 0) + (s.neutralMinionsKilled ?? 0)
  const damage = s.totalDamageDealtToChampions ?? 0
  const gold = s.goldEarned ?? 0
  const taken = s.totalDamageTaken ?? 0

  // Team totals over my team
  const myTeam = me.teamId ?? 100
  let teamKills = 0
  let teamDamage = 0
  let teamTaken = 0
  for (const p of game.participants) {
    if ((p.teamId ?? 100) === myTeam) {
      const ps = p.stats ?? {}
      teamKills += ps.kills ?? 0
      teamDamage += ps.totalDamageDealtToChampions ?? 0
      teamTaken += ps.totalDamageTaken ?? 0
    }
  }

  // killParticipation capped to [0,1] (a player's k+a can exceed team kills
  // in low-kill games where assists are double-counted)
  const kpRaw = teamKills === 0 ? 0 : (k + a) / teamKills
  const killParticipation = Math.min(1, Math.max(0, kpRaw))
  const damageShare = teamDamage === 0 ? 0 : damage / teamDamage
  const damageTakenShare = teamTaken === 0 ? 0 : taken / teamTaken

  const teamPosition: TeamPosition = inferTeamPosition({
    teamPosition: me.teamPosition ?? '',
    spellIds: [me.spell1Id ?? 0, me.spell2Id ?? 0],
    championId: me.championId ?? 0
  })

  return {
    win: s.win ?? false,
    championId: me.championId ?? 0,
    queueId: game.queueId,
    queueName: queueIdToName(game.queueId, nameMap),
    durationMin: Math.round(game.gameDuration / 60),
    kda: { k, d, a, ratio: (k + a) / dForRatio },
    damage,
    gold,
    cs,
    killParticipation: Math.round(killParticipation * 10) / 10,
    damageShare: Math.round(damageShare * 100) / 100,
    damageTakenShare: Math.round(damageTakenShare * 100) / 100,
    wardScore: s.visionScore ?? 0,
    multiKillsMax: pickMultiKillsMax(s),
    dpm: safePerMinute(damage, game.gameDuration),
    gpm: safePerMinute(gold, game.gameDuration),
    csm: safePerMinute(cs, game.gameDuration),
    lane: me.timeline?.lane ?? '',
    teamPosition
  }
}

/**
 * 将特征列表按胜负拆分为两个数组。
 */
export function splitWinsLosses(features: GameFeature[]): {
  wins: GameFeature[]
  losses: GameFeature[]
} {
  const wins: GameFeature[] = []
  const losses: GameFeature[] = []
  for (const f of features) {
    if (f.win) wins.push(f)
    else losses.push(f)
  }
  return { wins, losses }
}
