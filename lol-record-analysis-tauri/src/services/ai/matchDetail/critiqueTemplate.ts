/**
 * Stage 2 失败兜底渲染：把 AttributionResult 转成简版 markdown 报告。
 *
 * 与正式 Stage 2 输出共享 5 段标题，让 UI 不需要分支渲染。
 * 内容直接基于 verdict 字段，不调用 AI。
 */

import type {
  AttributionResult,
  EvidenceMetric,
  MitigatingFactor,
  Verdict,
  VerdictLabel
} from './types'

const NEGATIVE_LABELS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>([
  '被爆',
  '被连累',
  '缚地灵'
])

const CRIMINAL_LABELS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>(['犯罪'])

const POSITIVE_LABELS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>(['尽力'])

export function renderFallbackCritique(attribution: AttributionResult): string {
  const efforts = attribution.verdicts.filter(v => POSITIVE_LABELS.has(v.label))
  const criminals = attribution.verdicts.filter(v => CRIMINAL_LABELS.has(v.label))
  const negatives = attribution.verdicts.filter(v => NEGATIVE_LABELS.has(v.label))

  const headline = buildHeadline(attribution)
  const effortsBlock =
    efforts.length === 0
      ? '- 本局都是混子局，没人称得上扛把子'
      : efforts.map(renderVerdictLine).join('\n')
  const criminalsBlock =
    criminals.length === 0
      ? '- 本局没人能甩锅，混战自有命数'
      : criminals.map(renderVerdictLine).join('\n')
  const negativesBlock =
    negatives.length === 0 ? '- 无明显被针对者' : negatives.map(renderVerdictLine).join('\n')

  const evidenceBlock = collectKeyEvidence(attribution)

  return `> Stage 2 AI 不可用，已切换简版报告。

## 一句话定论
${headline}

## 谁尽力了
${effortsBlock}

## 谁要背锅
${criminalsBlock}

## 谁被打爆 / 被连累
${negativesBlock}

## 关键证据
${evidenceBlock}
`
}

function buildHeadline(attribution: AttributionResult): string {
  return attribution.winReason
}

function renderVerdictLine(v: Verdict): string {
  const evidence = v.evidenceMetrics.slice(0, 2).map(formatMetric).join('，')
  const mitigation = renderMitigations(v.mitigatingFactors)
  const tail = mitigation ? ` ${mitigation}` : ''
  return `- ${v.name}（${v.label}）：${v.finalCall} — ${evidence}${tail}`
}

function renderMitigations(factors: MitigatingFactor[]): string {
  if (factors.length === 0) return ''
  const phrases = factors.map(f => {
    switch (f.factor) {
      case 'off-role':
        return '（在补位）'
      case 'first-time-champion':
        return '（首次玩此英雄）'
      case 'team-collapse':
        return '（队友连锁崩盘）'
      case 'targeted':
        return '（被针对）'
      default:
        return ''
    }
  })
  return phrases.join('')
}

function formatMetric(m: EvidenceMetric): string {
  const rank = m.teamRank ? `(队内 #${m.teamRank})` : ''
  return `${m.metric}=${m.value}${rank}`
}

function collectKeyEvidence(attribution: AttributionResult): string {
  // Pick the most extreme metrics across all verdicts; up to 5.
  const lines: string[] = []
  for (const v of attribution.verdicts) {
    for (const m of v.evidenceMetrics) {
      if (m.teamRank === 1 || m.teamRank === 5) {
        lines.push(
          `- ${v.name} ${m.metric}=${m.value} (队内 #${m.teamRank})${m.note ? '，' + m.note : ''}`
        )
        if (lines.length >= 5) break
      }
    }
    if (lines.length >= 5) break
  }
  // Fallback: just take first evidenceMetric of each verdict
  if (lines.length === 0) {
    for (const v of attribution.verdicts.slice(0, 5)) {
      const m = v.evidenceMetrics[0]
      if (m) lines.push(`- ${v.name} ${m.metric}=${m.value}`)
    }
  }
  return lines.join('\n')
}
