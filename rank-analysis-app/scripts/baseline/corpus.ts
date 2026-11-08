/**
 * 基准语料解析：collect.mjs 写出的 games.jsonl（SGP SUMMARY 精简版）→ 打分输入。
 *
 * 采集已于 2026-11-07 结束（约 54.8k 局），但仍保留容错：任何解析失败的行（如中断时写了一半的末行）直接跳过。
 * DETAILS 与 SUMMARY 同源（SGP match-v5），participantId 一致，无需 remap。
 */
import { attributeDeaths } from '../../src/services/ai/shared/scoring/deathAttribution'
import { endMetrics, timelineMetrics } from '../../src/services/ai/shared/scoring/metrics'
import type { PlayerScoringInput } from '../../src/services/ai/shared/scoring/scorePlayers'
import type { RosterPlayer, SlimTimeline } from '../../src/services/ai/shared/timeline/types'

/** games.jsonl 里一名玩家（只声明用到的字段） */
export interface SummaryParticipant {
  participantId: number
  /** 只用于采集去重，构建不读、产物不含 */
  puuid?: string
  teamId: number
  championId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  totalDamageDealtToChampions: number
  goldEarned: number
  totalMinionsKilled: number
  neutralMinionsKilled: number
  visionScore?: number
  damageDealtToObjectives?: number
  timeCCingOthers?: number
  teamPosition?: string
}

export interface SummaryGame {
  gameId: number
  platformId: string
  queueId: number
  gameDuration: number
  gameVersion: string
  participants: SummaryParticipant[]
}

/** 收进基准的队列 */
export const CORPUS_QUEUES: ReadonlySet<number> = new Set([420, 440, 450, 2400])
/** 有分路的队列 */
export const LANED_QUEUES: ReadonlySet<number> = new Set([420, 440])
const MIN_DURATION_SEC = 300

/** 容错解析：跳过坏行/半行、重复 gameId、非目标队列、<5 分钟、人数 <2 的局 */
export function parseGamesJsonl(text: string): SummaryGame[] {
  const seen = new Set<number>()
  const out: SummaryGame[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let g: SummaryGame
    try {
      g = JSON.parse(line) as SummaryGame
    } catch {
      continue
    }
    if (!g || typeof g.gameId !== 'number' || seen.has(g.gameId)) continue
    if (!CORPUS_QUEUES.has(g.queueId) || !(g.gameDuration >= MIN_DURATION_SEC)) continue
    if (!Array.isArray(g.participants) || g.participants.length < 2) continue
    seen.add(g.gameId)
    out.push(g)
  }
  return out
}

/**
 * SUMMARY（可选带裁剪时间线）→ 打分输入，与 app 的 scoreSnapshot 同口径。
 * @param slim - 该局 DETAILS 裁剪结果；null = 只用终局指标
 */
export function toScoringInputs(g: SummaryGame, slim: SlimTimeline | null): PlayerScoringInput[] {
  const hasLanes = LANED_QUEUES.has(g.queueId)
  const teamKills = new Map<number, number>()
  for (const p of g.participants) teamKills.set(p.teamId, (teamKills.get(p.teamId) ?? 0) + p.kills)
  const roster: RosterPlayer[] = g.participants.map(p => ({
    participantId: p.participantId,
    teamId: p.teamId,
    teamPosition: hasLanes ? (p.teamPosition ?? '') : '',
    champion: String(p.championId),
    name: ''
  }))
  const cardInput = slim
    ? { tl: slim, roster, hasLanes, hasItemBuild: true, mapId: hasLanes ? 11 : 12 }
    : null
  const deaths = cardInput ? attributeDeaths(cardInput) : null
  const tlm = cardInput && deaths ? timelineMetrics(cardInput, deaths, g.gameDuration) : null

  return g.participants.map(p => ({
    participantId: p.participantId,
    teamId: p.teamId,
    win: p.win,
    position: hasLanes ? (p.teamPosition ?? '') : '',
    championId: p.championId,
    end: endMetrics({
      durationSec: g.gameDuration,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      teamKills: teamKills.get(p.teamId) ?? 0,
      damageToChampions: p.totalDamageDealtToChampions,
      gold: p.goldEarned,
      cs: p.totalMinionsKilled + p.neutralMinionsKilled,
      visionScore: p.visionScore ?? null,
      objectiveDamage: p.damageDealtToObjectives ?? null,
      ccSeconds: p.timeCCingOthers ?? null
    }),
    timeline: tlm?.[p.participantId] ?? null,
    deaths: deaths ? deaths.filter(d => d.victimId === p.participantId) : null
  }))
}
