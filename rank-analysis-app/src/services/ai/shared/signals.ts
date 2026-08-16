/**
 * 关联信号引擎（纯函数）：按远程下发的信号规则，确定性计算跨位置联动信号。
 *
 * 与设计文档 §6 对应：规则（阈值 + 文案模板）来自知识库 `signalRules`，
 * 远程改阈值/文案即可调整判定口径，不发版。AI 只负责解读本引擎产出的
 * 事实信号，不重新计算。
 *
 * 防御式输入：未知指标 / 畸形运算符静默跳过（远程规则不可信），
 * 数据缺失的 subject 天然不命中任何条件。
 */

import type { RecentPlayerProfile } from './types'

export type SignalOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq'
export type SignalScope = 'teammate' | 'enemy' | 'self'
export type SignalSeverity = 'info' | 'warn' | 'danger'

/** 与 scripts/build-knowledge.mjs 的 KNOWN_METRICS 保持一致的白名单 */
export const KNOWN_METRICS: readonly string[] = [
  'lossStreak',
  'winRate10',
  'games10',
  'isOffRole',
  'recentKda'
]

const METRIC_SET = new Set<string>(KNOWN_METRICS)
const OPS = new Set<SignalOp>(['lt', 'lte', 'gt', 'gte', 'eq'])

export interface SignalCondition {
  metric: string
  op: SignalOp
  value: number
}

export interface SignalRule {
  id: string
  scope: SignalScope
  /** 可选：仅特定位置（Riot 标准 TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY）生效 */
  position?: string
  /** 全部满足才命中（可空） */
  whenAll: SignalCondition[]
  /** 任一满足即命中（可空数组 = 不限制） */
  whenAny: SignalCondition[]
  /** 文案模板，支持 {name} 与 {metric} 占位符 */
  text: string
  severity: SignalSeverity
}

/** 一个可被规则判定的对象（一名玩家） */
export interface SignalSubject {
  puuid: string
  name: string
  scope: SignalScope
  position?: string
  /** 指标名 → 数值；缺失的指标不命中任何条件 */
  metrics: Record<string, number>
}

/** 引擎产出的信号，供 prompt 注入 */
export interface Signal {
  id: string
  subjectPuuid: string
  /** 占位符已全部替换的最终文案 */
  text: string
  severity: SignalSeverity
  /** 命中依据（条件原文），用于证据展示 */
  evidence: string[]
}

/** 指标展示格式化：胜率按百分数，其余按原值 */
export function formatMetric(metric: string, value: number): string {
  if (metric === 'winRate10') {
    return `${(value * 100).toFixed(0)}%`
  }
  if (Number.isInteger(value)) {
    return String(value)
  }
  return value.toFixed(1)
}

function compare(op: SignalOp, metric: number, threshold: number): boolean {
  switch (op) {
    case 'lt':
      return metric < threshold
    case 'lte':
      return metric <= threshold
    case 'gt':
      return metric > threshold
    case 'gte':
      return metric >= threshold
    case 'eq':
      return metric === threshold
    default:
      return false
  }
}

/** 判定单个条件；未知指标 / 数据缺失按不满足处理 */
function conditionMet(cond: SignalCondition, metrics: Record<string, number>): boolean {
  if (!METRIC_SET.has(cond.metric)) {
    if (import.meta.env?.DEV) {
      console.warn(`[signals] 未知指标已跳过: ${cond.metric}`)
    }
    return false
  }
  if (!OPS.has(cond.op)) {
    console.warn(`[signals] 未知运算符已跳过: ${cond.op}`)
    return false
  }
  const value = metrics[cond.metric]
  if (typeof value !== 'number' || Number.isNaN(value)) return false
  return compare(cond.op, value, cond.value)
}

function conditionEvidence(cond: SignalCondition, metrics: Record<string, number>): string {
  return `${cond.metric}=${formatMetric(cond.metric, metrics[cond.metric])} (${cond.op} ${cond.value})`
}

function fillTemplate(
  template: string,
  subject: SignalSubject,
  met: Record<string, number>
): string {
  let text = template.replace(/\{name\}/g, subject.name)
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const key = match[1]
    const v = met[key]
    if (typeof v === 'number' && !Number.isNaN(v)) {
      text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), formatMetric(key, v))
    }
  }
  return text
}

function ruleMatches(rule: SignalRule, subject: SignalSubject): SignalCondition[] {
  // scope 与 position 过滤
  if (rule.scope !== subject.scope) return []
  if (rule.position && rule.position !== subject.position) return []
  const metrics = subject.metrics
  // 远程规则防御：缺失的条件数组按空处理（空条件 = 不做限制）
  const whenAll = rule.whenAll ?? []
  const whenAny = rule.whenAny ?? []

  const allOk = whenAll.length === 0 || whenAll.every(c => conditionMet(c, metrics))
  if (!allOk) return []
  if (whenAny.length > 0 && !whenAny.some(c => conditionMet(c, metrics))) {
    return []
  }
  // 证据：whenAll 有命中条件时收录之；全空规则（仅 whenAny）收录 whenAny 命中项
  const allEvidence = whenAll.filter(c => conditionMet(c, metrics))
  if (allEvidence.length > 0) return allEvidence
  return whenAny.filter(c => conditionMet(c, metrics))
}

/**
 * 求值：对每个 subject 应用全部规则，返回命中信号
 * @param subjects - 玩家主体列表
 * @param rules - 远程信号规则（畸形规则静默跳过）
 */
export function evaluateSignals(subjects: SignalSubject[], rules: SignalRule[]): Signal[] {
  const out: Signal[] = []
  for (const subject of subjects) {
    for (const rule of rules) {
      if (!rule || typeof rule.id !== 'string' || !rule.text) continue
      const evidence = ruleMatches(rule, subject)
      if (evidence.length > 0) {
        out.push({
          id: rule.id,
          subjectPuuid: subject.puuid,
          text: fillTemplate(rule.text, subject, subject.metrics),
          severity: rule.severity,
          evidence: evidence.map(c => conditionEvidence(c, subject.metrics))
        })
      }
    }
  }
  // 稳定排序：info → warn → danger（危险在前），同 severity 保持规则序
  const order: Record<SignalSeverity, number> = { danger: 0, warn: 1, info: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

/** 会话玩家（宽松形状，与 prompts/team.ts 的 SessionPlayerLike 兼容） */
export interface SignalSessionPlayer {
  championId?: number
  summoner?: { puuid?: string; gameName?: string }
  assignedPosition?: string
  isMyTeam?: boolean
}

export interface SignalSessionData {
  subteams?: Array<{ subteamId: number; players: SignalSessionPlayer[] }>
  mySubteamId?: number
  isMultiTeam?: boolean
}

/** 从会话 + 近期画像聚合为信号引擎输入（画像缺失的玩家给空指标，防御） */
export function buildSignalSubjects(
  sessionData: SignalSessionData,
  profileMap: ReadonlyMap<string, RecentPlayerProfile | null>,
  myPuuid?: string
): SignalSubject[] {
  const mySubteamId = sessionData.mySubteamId ?? 0
  const subteams = sessionData.subteams ?? []
  const subjects: SignalSubject[] = []

  for (const st of subteams) {
    const mine = st.subteamId === mySubteamId
    for (const p of st.players ?? []) {
      const puuid = p.summoner?.puuid
      if (!puuid) continue
      const scope: SignalScope = puuid === myPuuid ? 'self' : mine ? 'teammate' : 'enemy'
      const profile = profileMap.get(puuid)
      const pos = p.assignedPosition
      subjects.push({
        puuid,
        name: p.summoner?.gameName || '未知',
        scope,
        position: pos && pos !== 'NONE' ? pos : undefined,
        metrics: profile ? profileToMetrics(profile) : {}
      })
    }
  }
  return subjects
}

/** 从近期画像提取信号可用的指标（missing → 不命中任何条件） */
export function profileToMetrics(profile: RecentPlayerProfile): Record<string, number> {
  const totalGames = profile.positionDistribution.reduce((acc, p) => acc + p.games, 0)
  return {
    lossStreak: profile.streak?.kind === 'loss' ? profile.streak.count : 0,
    winRate10: profile.recentWinRate,
    games10: totalGames,
    isOffRole: profile.isOffRole ? 1 : 0,
    recentKda: profile.recentKda
  }
}
