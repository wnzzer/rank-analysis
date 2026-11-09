/**
 * 评分指标定义（app 与 scripts/baseline 构建脚本共用，保证基准与打分口径一致）。
 *
 * 终局指标：来自战绩终局数据（LCU gameDetail 或 SGP SUMMARY），输入形状见 EndStatsInput。
 * 时间线指标：来自裁剪时间线（participantId 已对齐名册），只在有时间线时有值。
 * 任何指标拿不到时为 null（不当 0 用），由评分层跳过。
 * 「越低越好」指标（死亡类/缺席类）的符号处理集中在 subScores.ts 的 LOWER_IS_BETTER，这里只算原值。
 */
import { dist, positionAt } from '../timeline/geometry'
import { clusterFights, fightPresence } from '../timeline/cards/fight'
import { laneOpponent } from '../timeline/cards/lane'
import { laneCheckFrame } from '../timeline/teamContext'
import type { CardInput, SlimEvent } from '../timeline/types'
import { blameOf, LANE_PHASE_MS, type AttributedDeath } from './deathAttribution'

/** 终局指标名单 */
export const END_METRICS = [
  'dpm',
  'gpm',
  'csm',
  'kda',
  'killParticipation',
  'deathsPerMin',
  'visionPerMin',
  'damagePerGold',
  'objectiveDamagePerMin',
  'ccPerMin'
] as const
export type EndMetric = (typeof END_METRICS)[number]

/** 时间线指标名单 */
export const TIMELINE_METRICS = [
  'goldDiff14',
  'xpDiff14',
  'csDiff14',
  'deathCostPerMin',
  'laneDeathResponsibility',
  'fightAbsenceRate',
  'fightFirstDeathRate',
  'objectiveParticipation',
  'controlWardsPerMin'
] as const
export type TimelineMetric = (typeof TIMELINE_METRICS)[number]

export type MetricName = EndMetric | TimelineMetric
export type EndMetricValues = Record<EndMetric, number | null>
export type TimelineMetricValues = Record<TimelineMetric, number | null>

/**
 * 终局指标输入（LCU 与 SGP SUMMARY 都能映射成这个形状）
 * @property teamKills - 本队总击杀（参团率分母）
 * @property cs - 小兵 + 野怪
 * @property visionScore / objectiveDamage / ccSeconds - 拿不到时为 null
 */
export interface EndStatsInput {
  durationSec: number
  kills: number
  deaths: number
  assists: number
  teamKills: number
  damageToChampions: number
  gold: number
  cs: number
  visionScore: number | null
  objectiveDamage: number | null
  ccSeconds: number | null
}

/** 野怪参与：距野怪坑 ≤2500 码算在场 */
const OBJECTIVE_RADIUS = 2500

/**
 * 计算终局指标。
 * @returns killParticipation 为 0~1 小数（不是百分比）
 */
export function endMetrics(s: EndStatsInput): EndMetricValues {
  const min = s.durationSec / 60
  const perMin = (v: number | null): number | null => (v === null || min <= 0 ? null : v / min)
  return {
    dpm: perMin(s.damageToChampions),
    gpm: perMin(s.gold),
    csm: perMin(s.cs),
    kda: (s.kills + s.assists) / Math.max(1, s.deaths),
    killParticipation: (s.kills + s.assists) / Math.max(1, s.teamKills),
    deathsPerMin: perMin(s.deaths),
    visionPerMin: perMin(s.visionScore),
    damagePerGold: s.gold > 0 ? s.damageToChampions / s.gold : null,
    objectiveDamagePerMin: perMin(s.objectiveDamage),
    ccPerMin: perMin(s.ccSeconds)
  }
}

type Elite = Extract<SlimEvent, { type: 'ELITE_MONSTER_KILL' }>

/**
 * 计算名册内每位玩家的时间线指标。
 * @param deaths - attributeDeaths(input) 的结果
 * @param durationSec - 对局时长（秒）
 * @returns participantId → 指标
 */
export function timelineMetrics(
  input: CardInput,
  deaths: AttributedDeath[],
  durationSec: number
): Record<number, TimelineMetricValues> {
  const { tl, roster, hasLanes } = input
  const minutes = durationSec / 60
  const perMin = (v: number): number | null => (minutes > 0 ? v / minutes : null)
  const frame = hasLanes ? laneCheckFrame(input) : undefined
  const fights = clusterFights(input)
  const presence = fights.map(f => fightPresence(input, f))
  const teamOf = new Map(roster.map(r => [r.participantId, r.teamId]))
  const elites = tl.events.filter((e): e is Elite => e.type === 'ELITE_MONSTER_KILL')
  const out: Record<number, TimelineMetricValues> = {}

  for (const me of roster) {
    const pid = me.participantId
    let goldDiff14: number | null = null
    let xpDiff14: number | null = null
    let csDiff14: number | null = null
    const opp = frame ? laneOpponent(roster, pid) : undefined
    const a = frame?.players.find(p => p.participantId === pid)
    const b = opp ? frame?.players.find(p => p.participantId === opp.participantId) : undefined
    if (a && b) {
      goldDiff14 = a.totalGold - b.totalGold
      xpDiff14 = a.xp - b.xp
      csDiff14 = a.cs - b.cs
    }

    // 本人阵亡 + 作为缺位搭档分担的阵亡（blameOf 对无关阵亡返回 0）
    const cost = deaths.reduce((s, d) => s + blameOf(d, pid) * d.consequence, 0)

    // 对线期（<14 分钟）阵亡责任之和：作为基线指标，让「正常死 1~2 次」不被扣分
    const laneDeathResponsibility = deaths
      .filter(d => d.timestamp < LANE_PHASE_MS)
      .reduce((s, d) => s + blameOf(d, pid), 0)

    const ownElites = elites.filter(e => e.killerTeamId === me.teamId)
    const atObjective = ownElites.filter(e => {
      if (e.killerId === pid) return true
      const p = positionAt(tl, pid, e.timestamp)
      return !!p && dist(p.x, p.y, e.x, e.y) <= OBJECTIVE_RADIUS
    }).length

    const controlWards = tl.events.filter(
      e => e.type === 'WARD_PLACED' && e.creatorId === pid && e.wardType === 'CONTROL_WARD'
    ).length

    out[pid] = {
      goldDiff14,
      xpDiff14,
      csDiff14,
      deathCostPerMin: perMin(cost),
      laneDeathResponsibility,
      fightAbsenceRate: fights.length
        ? presence.filter(set => !set.has(pid)).length / fights.length
        : null,
      fightFirstDeathRate: fights.length
        ? fights.filter(
            f => f.kills.find(k => teamOf.get(k.victimId) === me.teamId)?.victimId === pid
          ).length / fights.length
        : null,
      objectiveParticipation: ownElites.length ? atObjective / ownElites.length : null,
      controlWardsPerMin: perMin(controlWards)
    }
  }
  return out
}
