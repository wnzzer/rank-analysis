/**
 * Stage 2 结构化复盘输出解析与名册装配。
 *
 * 分层：
 * 1. validateCritiqueReport: 解析模型 JSON（兼容 fenced 包装），宽松形状校验。
 * 2. assembleAnalysisReport: 把 Stage 1 已校验的 verdicts（label 固定映射）与模型
 *    文案（comments/evidence/评分）合成为最终 AIAnalysisReport——名册分组
 *    （尽力/犯罪/被爆）永远来自 Stage 1，模型只提供理由文案，杜绝模型改判。
 */

import type { ParseOutcome } from '../shared/twoStage'
import type { AIAnalysisReport, AttributionResult } from './types'

/** 模型输出的原始草案：名册之外的纯文案。 */
export interface CritiqueDraft {
  /** 整局定论（win/loss/neutral） */
  verdict?: string
  /** 一句话定论（锐评） */
  oneLiner?: string
  /** participantId → 该玩家的锐评一句（含数字证据） */
  comments?: Record<string, string>
  /** 关键证据 3-5 条（必须带数字） */
  evidence?: string[]
  /** 单人复盘：目标玩家评分 1-10 */
  rating?: number
  /** 单人复盘：最突出的数字解读 */
  metrics?: string[]
  /** 单人复盘：改进建议 */
  improvements?: Array<{ title?: string; evidence?: string; suggestion?: string }>
}

/** 归一化的名册映射（assemble 内部使用） */
const MVP_LABELS = new Set(['尽力'])
const SINK_LABELS = new Set(['犯罪', '缚地灵'])
const CRUSHED_LABELS = new Set(['被爆', '被连累'])

/** 把 Stage 1 verdicts 按 label 确定性分组为三个名册。 */
function groupVerdicts(attribution: AttributionResult) {
  const mvps: AIAnalysisReport['mvps'] = []
  const sunkCosts: AIAnalysisReport['sunkCosts'] = []
  const crushed: AIAnalysisReport['crushed'] = []
  for (const v of attribution.verdicts) {
    if (MVP_LABELS.has(v.label)) mvps.push({ participantId: v.participantId, reason: '' })
    else if (SINK_LABELS.has(v.label))
      sunkCosts.push({ participantId: v.participantId, reason: '' })
    else if (CRUSHED_LABELS.has(v.label))
      crushed.push({ participantId: v.participantId, reason: '' })
  }
  return { mvps, sunkCosts, crushed }
}

/** 找某玩家在归因里的 finalCall（模型没给 comment 时的兜底文案）。 */
function findFinalCall(attribution: AttributionResult, participantId: number): string {
  return (
    attribution.verdicts.find(v => v.participantId === participantId)?.finalCall ?? '（无补充）'
  )
}

/**
 * 合成最终报告：名册分组确定性来自 Stage 1；文案来自模型草案（缺失时
 * 用 finalCall 兜底）。纯函数，便于单测。
 */
export function assembleAnalysisReport(
  attribution: AttributionResult,
  draft: CritiqueDraft
): AIAnalysisReport {
  const groups = groupVerdicts(attribution)
  const comments = draft.comments ?? {}
  const take = (participantId: number) =>
    comments[String(participantId)] || findFinalCall(attribution, participantId)

  const report: AIAnalysisReport = {
    verdict: draft.verdict === 'win' || draft.verdict === 'loss' ? draft.verdict : 'neutral',
    oneLiner: draft.oneLiner || attribution.winReason || '（无定论）',
    mvps: groups.mvps.map(p => ({ participantId: p.participantId, reason: take(p.participantId) })),
    sunkCosts: groups.sunkCosts.map(p => ({
      participantId: p.participantId,
      reason: take(p.participantId)
    })),
    crushed: groups.crushed.map(p => ({
      participantId: p.participantId,
      reason: take(p.participantId)
    })),
    evidence:
      Array.isArray(draft.evidence) && draft.evidence.length > 0
        ? draft.evidence.slice(0, 5)
        : collectFallbackEvidence(attribution)
  }

  const rating = typeof draft.rating === 'number' ? draft.rating : 0
  const metrics = Array.isArray(draft.metrics) ? draft.metrics : []
  if (rating >= 1 && rating <= 10) {
    report.ownScore = { rating: Math.round(rating), metrics: metrics.slice(0, 5) }
  }
  if (Array.isArray(draft.improvements) && draft.improvements.length > 0) {
    report.improvements = draft.improvements
      .filter(i => i && typeof i.title === 'string' && i.title.trim() !== '')
      .slice(0, 3)
      .map(i => ({
        title: i.title!,
        evidence: i.evidence ?? '',
        suggestion: i.suggestion ?? ''
      }))
  }
  return report
}

/** 模型没给证据时：从归因 metrics 里挑 teamRank 极端的（与 critiqueTemplate 同思路）。 */
function collectFallbackEvidence(attribution: AttributionResult): string[] {
  const lines: string[] = []
  for (const v of attribution.verdicts) {
    for (const m of v.evidenceMetrics) {
      if (m.teamRank === 1 || m.teamRank === 5) {
        lines.push(`${v.name} ${m.metric}=${m.value}${m.note ? '，' + m.note : ''}`)
        if (lines.length >= 3) return lines
      }
    }
  }
  for (const v of attribution.verdicts.slice(0, 3)) {
    const m = v.evidenceMetrics[0]
    if (m) lines.push(`${v.name} ${m.metric}=${m.value}`)
    if (lines.length >= 3) break
  }
  return lines
}

/** 解析模型草案 JSON（宽松形状校验，值清洗后回传）。 */
export function validateCritiqueReport(raw: string): ParseOutcome<CritiqueDraft> {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1')
    .trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${(err as Error).message}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'parsed value is not an object' }
  }
  const candidate = parsed as CritiqueDraft
  if (
    typeof candidate.oneLiner !== 'string' &&
    typeof candidate.verdict !== 'string' &&
    (typeof candidate.comments !== 'object' || candidate.comments === null)
  ) {
    return { ok: false, error: 'missing oneLiner/verdict/comments' }
  }
  return { ok: true, value: candidate }
}
