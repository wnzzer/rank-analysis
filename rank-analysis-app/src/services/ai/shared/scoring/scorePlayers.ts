/**
 * 一局玩家打分：app（scoreSnapshot）与基准构建脚本（scripts/baseline）共用的唯一入口。
 *
 * 流程：每个指标查基准（英雄格 → 位置格 → 队列格，查不到用本局相对统计）→ z →
 * 分项 → 按位置权重加总 → 队友对线分 + 本人死亡归责得减责证据 → 阈值格 → 标签。
 * 纯函数；输出顺序与输入一致。
 */
import type { VerdictLabel } from '../../matchDetail/types'
import { lookupStats, type Baseline, type MetricStats } from './baseline'
import type { AttributedDeath } from './deathAttribution'
import { decideLabel, mitigationEvidence, type Mitigation } from './labels'
import type { EndMetricValues, MetricName, TimelineMetricValues } from './metrics'
import { localStats, zScore } from './normalize'
import { combineSubScores, computeSubScores, type SubScores } from './subScores'
import { lookupThresholds, percentileBand, type Thresholds } from './thresholds'
import { weightProfile, type SubScoreKey } from './weights'

/**
 * 单个玩家的打分输入
 * @property position - teamPosition（无分路模式任意值，内部按 `*` 处理）
 * @property timeline / deaths - 无时间线时为 null
 */
export interface PlayerScoringInput {
  participantId: number
  teamId: number
  win: boolean
  position: string
  championId: number
  end: EndMetricValues
  timeline: TimelineMetricValues | null
  deaths: AttributedDeath[] | null
}

export interface ScoringContext {
  queueId: number
  hasLanes: boolean
}

export interface ScoringData {
  baseline: Baseline
  thresholds: Thresholds
}

/**
 * 单个玩家的打分结果
 * @property total - 总分（单位：基准标准差）
 * @property band - 在同队列×位置语料里的分档，如 'P60~P70'
 */
export interface PlayerScore {
  participantId: number
  total: number
  band: string
  sub: SubScores
  contributions: Partial<Record<SubScoreKey, number>>
  mitigation: Mitigation
  label: VerdictLabel
  deaths: AttributedDeath[] | null
}

/** 给一局所有玩家打分 */
export function scorePlayers(
  players: PlayerScoringInput[],
  ctx: ScoringContext,
  data: ScoringData
): PlayerScore[] {
  const values = players.map(
    p => ({ ...p.end, ...(p.timeline ?? {}) }) as Partial<Record<MetricName, number | null>>
  )
  const localCache = new Map<MetricName, MetricStats | null>()
  const local = (m: MetricName): MetricStats | null => {
    if (!localCache.has(m)) localCache.set(m, localStats(values.map(v => v[m] ?? null)))
    return localCache.get(m) ?? null
  }

  const first = players.map((p, i) => {
    const z = (m: MetricName) =>
      zScore(
        values[i][m] ?? null,
        lookupStats(data.baseline, ctx.queueId, p.position, p.championId, ctx.hasLanes, m) ??
          local(m)
      )
    const sub = computeSubScores({ hasLanes: ctx.hasLanes, position: p.position, z })
    return { sub, combined: combineSubScores(sub, weightProfile(p.position, ctx.hasLanes)) }
  })

  return players.map((p, i) => {
    const { sub, combined } = first[i]
    const mates = players.flatMap((q, j) =>
      q.teamId === p.teamId && j !== i ? [first[j].sub.lane] : []
    )
    const mitigation = mitigationEvidence(p.deaths, mates)
    // 本队唯一最高：严格高于每名队友（并列不算）；无队友时不成立（否则空真值会判为最高）
    const hasMate = players.some((q, j) => j !== i && q.teamId === p.teamId)
    const teamBest =
      hasMate &&
      players.every(
        (q, j) => j === i || q.teamId !== p.teamId || first[j].combined.total < combined.total
      )
    // 本队唯一最低：犯罪的主责人；同理并列不算、无队友不成立
    const teamWorst =
      hasMate &&
      players.every(
        (q, j) => j === i || q.teamId !== p.teamId || first[j].combined.total > combined.total
      )
    const thresholds = lookupThresholds(
      data.thresholds,
      ctx.queueId,
      p.position,
      ctx.hasLanes,
      p.timeline !== null
    )
    return {
      participantId: p.participantId,
      total: combined.total,
      band: percentileBand(combined.total, thresholds.total),
      sub,
      contributions: combined.contributions,
      mitigation,
      label: decideLabel({
        win: p.win,
        total: combined.total,
        sub,
        thresholds,
        mitigated: mitigation.mitigated,
        hasTimeline: p.timeline !== null,
        teamBest,
        teamWorst
      }),
      deaths: p.deaths
    }
  })
}
