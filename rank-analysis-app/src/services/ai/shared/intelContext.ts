/**
 * 版本情报 + 关联信号 + 模式知识的情报块构建器（prompt 注入共用）。
 *
 * 与设计文档 §7.1 对应：`buildIntelContext` 聚合
 * - 本局英雄的 OP.GG 版本情报（T级/胜率/主分路，数据来源标注外服）
 * - 我方 × 敌方对位克制（ranked 模式，OP.GG 胜率 + 「仅供参考」标注）
 * - 信号引擎产出的关联信号（基于近期战绩的确定性事实）
 * - 按 queueId 选取的模式知识（知识库远程下发）
 *
 * 只含本局相关条目以控制 token；任何子块数据缺失时整体省略该块。
 */

import { getChampionMeta, getLaneCounters, type OpggMode } from '@renderer/services/opgg'
import { getKnowledgeBase } from '@renderer/services/knowledge'
import { getChampionName } from '../champion-names'
import {
  evaluateSignals,
  buildSignalSubjects,
  type Signal,
  type SignalSessionData
} from './signals'
import type { RecentPlayerProfile } from './types'

/** 模式知识 key 映射：ranked → ranked / aram → aram / 海克斯乱斗(1700) → brawl / 其余无 */
export function modeKnowledgeKey(modeKind: string, queueId: number): string | null {
  if (modeKind === 'ranked') return 'ranked'
  if (modeKind === 'aram') return 'aram'
  if (modeKind === 'augment' && queueId === 1700) return 'brawl'
  return null
}

export interface IntelContextInput {
  sessionData: SignalSessionData
  profileMap: ReadonlyMap<string, RecentPlayerProfile | null>
  myPuuid?: string
  /** OP.GG 数据模式；缺省（如斗魂等无数据模式）时跳过版本情报与克制块 */
  opggMode?: OpggMode
  /** 模式语义分类（modeContext.kind）与队列 ID（按需映射模式知识） */
  modeKind?: string
  queueId?: number
}

export interface IntelContext {
  /** 【版本情报 · 26.13 · 数据来源OP.GG(外服)】头部；无数据时为空串 */
  header: string
  /** 本局英雄版本情报行 */
  championLines: string[]
  /** 对线克制行（ranked only） */
  counterLines: string[]
  /** 关联信号行（来自信号引擎） */
  signalLines: string[]
  /** 模式知识行（知识库，最多 4 条） */
  modeKnowledgeLines: string[]
}

function metaLine(id: number, mode: OpggMode): Promise<string | null> {
  return getChampionMeta(mode, id).then(meta => {
    if (!meta) return null
    const winRate = meta.winRate ? `${(meta.winRate * 100).toFixed(1)}%` : '--'
    return `- ${getChampionName(id)}（${meta.position}）: T${meta.tier}，胜率${winRate}`
  })
}

/** 我们的英雄 vs 敌方英雄的对位克制行（最多 3 条，ranked only） */
async function buildCounterLines(
  myIds: number[],
  enemyIds: number[],
  mode: OpggMode
): Promise<string[]> {
  if (myIds.length === 0 || enemyIds.length === 0) return []
  const countersByChampion = (await getLaneCounters(mode, [...myIds, ...enemyIds])) ?? {}
  const lines: string[] = []
  for (const myId of myIds) {
    const counters = countersByChampion[myId] ?? []
    for (const counter of counters) {
      if (!enemyIds.includes(counter.opponentId)) continue
      const winRate = (counter.subjectWinRate * 100).toFixed(0)
      lines.push(
        `- ${counter.position}：${getChampionName(myId)} 对 ${getChampionName(counter.opponentId)} 对线胜率${winRate}%（仅供参考）`
      )
      if (lines.length >= 3) return lines
    }
  }
  return lines
}

/**
 * 构建情报块（不抛异常：所有外部取数失败降级为空块）
 */
export async function buildIntelContext(input: IntelContextInput): Promise<IntelContext> {
  const ctx: IntelContext = {
    header: '',
    championLines: [],
    counterLines: [],
    signalLines: [],
    modeKnowledgeLines: []
  }
  const knowledge = await getKnowledgeBase()
  const opggMode = input.opggMode
  if (opggMode) {
    const subteams = input.sessionData.subteams ?? []
    const mySubteamId = input.sessionData.mySubteamId ?? 0
    const allChampIds = Array.from(
      new Set(
        subteams
          .flatMap(st => st.players ?? [])
          .map(p => p.championId ?? 0)
          .filter(id => id > 0)
      )
    )
    if (allChampIds.length > 0) {
      const lines = (await Promise.all(allChampIds.map(id => metaLine(id, opggMode)))).filter(
        (l): l is string => l !== null
      )
      if (lines.length > 0) {
        ctx.header = `【版本情报 · ${knowledge?.patch ?? '未知版本'} · 数据来源OP.GG(外服)】`
        ctx.championLines = lines
      }
    }
    if (opggMode === 'ranked') {
      const myIds = (subteams.find(st => st.subteamId === mySubteamId)?.players ?? [])
        .map(p => p.championId ?? 0)
        .filter(id => id > 0)
      const enemyIds = subteams
        .filter(st => st.subteamId !== mySubteamId)
        .flatMap(st => st.players ?? [])
        .map(p => p.championId ?? 0)
        .filter(id => id > 0)
      ctx.counterLines = await buildCounterLines(myIds, enemyIds, opggMode)
    }
  }

  // 关联信号：知识库 signalRules 为空/不可用时整块省略
  if (knowledge && knowledge.signalRules.length > 0) {
    const subjects = buildSignalSubjects(input.sessionData, input.profileMap, input.myPuuid)
    const signals: Signal[] = evaluateSignals(subjects, knowledge.signalRules)
    ctx.signalLines = signals.map(s => `- [${s.severity}] ${s.text}`)
  }

  // 模式知识：按 modeKind + queueId 映射，最多 4 条
  const modeKey = input.modeKind ? modeKnowledgeKey(input.modeKind, input.queueId ?? 0) : null
  if (modeKey && knowledge) {
    ctx.modeKnowledgeLines = (knowledge.modeKnowledge[modeKey] ?? []).slice(0, 4)
  }

  return ctx
}

/** 块存在性：任何子块非空即视为可用 */
export function intelBlockExists(ctx: IntelContext): boolean {
  return (
    ctx.championLines.length > 0 ||
    ctx.counterLines.length > 0 ||
    ctx.signalLines.length > 0 ||
    ctx.modeKnowledgeLines.length > 0
  )
}

/** 拼接为单块文本（空子块省略） */
export function intelBlockToText(ctx: IntelContext): string {
  const parts: string[] = []
  if (ctx.header) {
    parts.push(ctx.header, ...ctx.championLines)
  }
  if (ctx.counterLines.length > 0) {
    parts.push('【对线克制】', ...ctx.counterLines)
  }
  if (ctx.signalLines.length > 0) {
    parts.push('【关联信号】（程序基于近期战绩计算的事实，请直接解读，不要重新计算）', ...ctx.signalLines)
  }
  if (ctx.modeKnowledgeLines.length > 0) {
    parts.push('【模式知识】', ...ctx.modeKnowledgeLines)
  }
  return parts.join('\n')
}