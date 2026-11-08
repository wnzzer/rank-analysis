/**
 * 评分的快照适配与必出名单。
 *
 * scoreSnapshot：MatchSnapshot → scorePlayers 输入（终局指标从快照玩家行算，时间线部分取
 * snapshot.timeline 里预先算好的 deaths/metrics）。
 * selectVerdicts：必出 = 本人、各队击杀/死亡第一、所有非正常；上限 7、下限 4（沿用 Round 3）。
 */
import type { MatchSnapshot } from '../snapshot'
import { BASELINE, THRESHOLDS } from './data'
import { endMetrics } from './metrics'
import { scorePlayers, type PlayerScore, type ScoringData } from './scorePlayers'

/** 入库基准 + 阈值 */
export const DEFAULT_SCORING_DATA: ScoringData = { baseline: BASELINE, thresholds: THRESHOLDS }

/**
 * 给快照里每位玩家打分。
 * @returns 顺序与 snapshot.players 一致
 */
export function scoreSnapshot(
  snapshot: MatchSnapshot,
  data: ScoringData = DEFAULT_SCORING_DATA
): PlayerScore[] {
  const teamKills = new Map<number, number>()
  for (const p of snapshot.players)
    teamKills.set(p.teamId, (teamKills.get(p.teamId) ?? 0) + p.kills)
  const tl = snapshot.timeline
  const inputs = snapshot.players.map(p => ({
    participantId: p.participantId,
    teamId: p.teamId,
    win: p.win,
    position: p.teamPosition,
    championId: p.championId,
    end: endMetrics({
      durationSec: snapshot.durationSeconds,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      teamKills: teamKills.get(p.teamId) ?? 0,
      damageToChampions: p.damage,
      gold: p.gold,
      cs: p.cs,
      visionScore: p.wardScore,
      objectiveDamage: p.objectiveDamage,
      ccSeconds: p.ccSeconds
    }),
    timeline: tl?.metrics[p.participantId] ?? null,
    deaths: tl ? tl.deaths.filter(d => d.victimId === p.participantId) : null
  }))
  return scorePlayers(
    inputs,
    { queueId: snapshot.queueId, hasLanes: snapshot.modeContext.hasLanes },
    data
  )
}

/** 选人需要的玩家字段（快照玩家行的子集） */
export interface VerdictCandidate {
  participantId: number
  teamId: number
  isMe?: boolean
  kills?: number
  deaths?: number
  kda?: number
}

export const MAX_VERDICTS = 7
export const MIN_VERDICTS = 4

const num = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** 每队按 key 取第一（死亡并列取 KDA 低者、击杀并列取 KDA 高者，再按 participantId） */
function teamTop(team: VerdictCandidate[], key: 'kills' | 'deaths'): VerdictCandidate | undefined {
  return [...team].sort((a, b) => {
    const d = num(b[key]) - num(a[key])
    if (d !== 0) return d
    const k = key === 'deaths' ? num(a.kda) - num(b.kda) : num(b.kda) - num(a.kda)
    if (k !== 0) return k
    return a.participantId - b.participantId
  })[0]
}

/**
 * 选出整局点名名单。
 * @returns 4-7 条（总人数不足 4 时全员），按影响力降序；影响力 = |总分| + 非正常 10
 */
export function selectVerdicts(
  players: VerdictCandidate[],
  scores: PlayerScore[]
): Array<PlayerScore & { mustInclude: boolean }> {
  const teams = new Map<number, VerdictCandidate[]>()
  for (const p of players) teams.set(p.teamId, [...(teams.get(p.teamId) ?? []), p])
  const core = new Set<number>()
  for (const p of players) if (p.isMe) core.add(p.participantId)
  for (const team of teams.values()) {
    const k = teamTop(team, 'kills')
    const d = teamTop(team, 'deaths')
    if (k) core.add(k.participantId)
    if (d) core.add(d.participantId)
  }
  const byId = new Map(scores.map(s => [s.participantId, s]))
  const all = players.flatMap(p => {
    const s = byId.get(p.participantId)
    if (!s) return []
    const isCore = core.has(p.participantId)
    return [
      {
        s,
        isMe: p.isMe === true,
        core: isCore,
        must: isCore || s.label !== '正常',
        impact: Math.abs(s.total) + (s.label === '正常' ? 0 : 10)
      }
    ]
  })
  type Row = (typeof all)[number]
  const byImpact = (a: Row, b: Row) => b.impact - a.impact || a.s.participantId - b.s.participantId
  const tier = (v: Row): number => (v.isMe ? 0 : v.core ? 1 : v.must ? 2 : 3)
  const ordered = [...all].sort((a, b) => tier(a) - tier(b) || byImpact(a, b))
  const wanted = all.filter(v => v.must).length
  const take = Math.min(ordered.length, MAX_VERDICTS, Math.max(wanted, MIN_VERDICTS))
  return ordered
    .slice(0, take)
    .sort(byImpact)
    .map(v => ({ ...v.s, mustInclude: v.must }))
}
