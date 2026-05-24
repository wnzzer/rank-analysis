/**
 * tagSuggest 内部类型（Stage 1 / Stage 2 IO）。
 *
 * 这些类型不导出到 src/types，仅在 services/ai/tagSuggest/ 子树内使用。
 * 公开类型 TagSuggestResult / TagSuggestion 仍在 src/types/tagSuggest.ts。
 */

import type { Operator } from '@renderer/types/tagSuggest'

// ─── metric whitelist ─────────────────────────────────────────────────────────

export const ALLOWED_METRICS = [
  'kda',
  'kills',
  'deaths',
  'damage',
  'dpm',
  'gold',
  'gpm',
  'cs',
  'csm',
  'killParticipation',
  'damageShare',
  'damageTakenShare',
  'wardScore',
  'multiKillsMax',
  'streak'
] as const

export type MetricName = (typeof ALLOWED_METRICS)[number]

export function isAllowedMetric(s: string): s is MetricName {
  return (ALLOWED_METRICS as readonly string[]).includes(s)
}

// ─── Stage 1 output ───────────────────────────────────────────────────────────

/**
 * 一条候选。
 * - 数值型 metric: direction 是 Operator（如 '>='）, threshold 是数值阈值。
 * - streak metric:  direction 是 'win'|'loss', countMin 是连续场次门槛, threshold 忽略（写 0）。
 */
export interface Candidate {
  id: string
  metric: MetricName
  queueIds: number[]
  direction: Operator | 'win' | 'loss'
  threshold: number
  countMin: number
  evidence: string
  vibe: string[]
}

export interface ModeBreakdown {
  queueIds: number[]
  queueName: string
  winSignals: string[]
  lossSignals: string[]
  sampleSize: number
}

export interface ProfileSummary {
  styleSummary: string
  modeBreakdown: ModeBreakdown[]
  goodCandidates: Candidate[]
  badCandidates: Candidate[]
}

// ─── Stage 2 output ───────────────────────────────────────────────────────────

export interface NamingEntry {
  id: string
  name: string
  desc: string
}

export interface NamingResult {
  good: NamingEntry[]
  bad: NamingEntry[]
  skipped: string[]
}
