/**
 * Stage 1 / Stage 2 输出校验器。
 *
 * Stage 1 校验 ProfileSummary（candidate metric 白名单、≥4 个候选等）。
 * Stage 2 校验 NamingResult（name 长度、永久禁用词等）。
 *
 * 不再做 TagCondition 校验 —— 那部分由 conditionBuilder 模板生成，不会出错。
 */

import { isAllowedMetric } from './types'
import type {
  Candidate,
  ProfileSummary,
  ModeBreakdown,
  NamingResult,
  NamingEntry
} from './types'

// ─── shared ───────────────────────────────────────────────────────────────────

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

const MIN_CANDIDATES = 4
const NAME_MIN_LEN = 2
const NAME_MAX_LEN = 7

export const PERMANENT_BANNED_NAMES: readonly string[] = [
  '送葬人',
  'carry王',
  '演员王',
  '送人头'
]

const VALID_OPERATORS: ReadonlySet<string> = new Set(['>', '>=', '<', '<=', '==', '!='])
const VALID_STREAK_DIRECTIONS: ReadonlySet<string> = new Set(['win', 'loss'])

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenceMatch ? fenceMatch[1] : trimmed
  const objMatch = candidate.match(/\{[\s\S]*\}/)
  return objMatch ? objMatch[0] : candidate
}

function tryParse(raw: string): ParseOutcome<unknown> {
  try {
    const cleaned = stripJsonFences(raw)
    const parsed = JSON.parse(cleaned)
    return { ok: true, value: parsed }
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${(e as Error).message}` }
  }
}

// ─── Stage 1 ──────────────────────────────────────────────────────────────────

function isModeBreakdown(v: unknown): v is ModeBreakdown {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.queueIds) || !o.queueIds.every(x => typeof x === 'number')) return false
  if (typeof o.queueName !== 'string') return false
  if (!Array.isArray(o.winSignals) || !o.winSignals.every(x => typeof x === 'string')) return false
  if (!Array.isArray(o.lossSignals) || !o.lossSignals.every(x => typeof x === 'string'))
    return false
  if (typeof o.sampleSize !== 'number') return false
  return true
}

function isCandidate(v: unknown): v is Candidate {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.length === 0) return false
  if (typeof o.metric !== 'string' || !isAllowedMetric(o.metric)) return false
  if (!Array.isArray(o.queueIds) || !o.queueIds.every(x => typeof x === 'number')) return false
  if (typeof o.direction !== 'string') return false
  if (o.metric === 'streak') {
    if (!VALID_STREAK_DIRECTIONS.has(o.direction)) return false
  } else {
    if (!VALID_OPERATORS.has(o.direction)) return false
  }
  if (typeof o.threshold !== 'number') return false
  if (typeof o.countMin !== 'number' || o.countMin < 1) return false
  if (typeof o.evidence !== 'string') return false
  if (!Array.isArray(o.vibe) || !o.vibe.every(x => typeof x === 'string')) return false
  return true
}

/**
 * 解析并校验 Stage 1 输出（ProfileSummary）。
 *
 * 通过条件：
 * - 顶层是对象
 * - styleSummary / modeBreakdown / goodCandidates / badCandidates 字段类型正确
 * - good / bad candidates 各 ≥ 4 个，且每个均通过 isCandidate 校验
 */
export function parseStage1(raw: string): ParseOutcome<ProfileSummary> {
  const parseResult = tryParse(raw)
  if (!parseResult.ok) return parseResult
  const root = parseResult.value
  if (typeof root !== 'object' || root === null) {
    return { ok: false, error: 'Stage 1 root is not an object' }
  }
  const o = root as Record<string, unknown>

  if (typeof o.styleSummary !== 'string') {
    return { ok: false, error: 'styleSummary missing or not a string' }
  }
  if (!Array.isArray(o.modeBreakdown)) {
    return { ok: false, error: 'modeBreakdown missing or not an array' }
  }
  for (const mb of o.modeBreakdown) {
    if (!isModeBreakdown(mb)) {
      return { ok: false, error: 'modeBreakdown entry invalid' }
    }
  }

  if (!Array.isArray(o.goodCandidates) || o.goodCandidates.length < MIN_CANDIDATES) {
    return { ok: false, error: `goodCandidates must be ≥ ${MIN_CANDIDATES}` }
  }
  if (!Array.isArray(o.badCandidates) || o.badCandidates.length < MIN_CANDIDATES) {
    return { ok: false, error: `badCandidates must be ≥ ${MIN_CANDIDATES}` }
  }

  for (const c of o.goodCandidates) {
    if (!isCandidate(c)) {
      return { ok: false, error: 'goodCandidate entry invalid' }
    }
  }
  for (const c of o.badCandidates) {
    if (!isCandidate(c)) {
      return { ok: false, error: 'badCandidate entry invalid' }
    }
  }

  return {
    ok: true,
    value: {
      styleSummary: o.styleSummary,
      modeBreakdown: o.modeBreakdown as ModeBreakdown[],
      goodCandidates: o.goodCandidates as Candidate[],
      badCandidates: o.badCandidates as Candidate[]
    }
  }
}

// ─── Stage 2 ──────────────────────────────────────────────────────────────────

function nameIsValid(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  const len = Array.from(trimmed).length
  if (len < NAME_MIN_LEN || len > NAME_MAX_LEN) return false
  if (PERMANENT_BANNED_NAMES.some(banned => trimmed.includes(banned))) return false
  return true
}

function descIsValid(desc: unknown): desc is string {
  return typeof desc === 'string' && desc.trim().length > 0
}

function isNamingEntry(v: unknown): v is NamingEntry {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.length === 0) return false
  if (!nameIsValid(o.name)) return false
  if (!descIsValid(o.desc)) return false
  return true
}

/**
 * 解析并校验 Stage 2 输出（NamingResult）。
 *
 * - 不合法的 entry 被静默丢弃（不报 parse 错误）
 * - 失败仅在 JSON 不可解析、或 good/bad 不是数组时返回
 */
export function parseStage2(raw: string): ParseOutcome<NamingResult> {
  const parseResult = tryParse(raw)
  if (!parseResult.ok) return parseResult
  const root = parseResult.value
  if (typeof root !== 'object' || root === null) {
    return { ok: false, error: 'Stage 2 root is not an object' }
  }
  const o = root as Record<string, unknown>

  if (!Array.isArray(o.good)) {
    return { ok: false, error: 'good must be an array' }
  }
  if (!Array.isArray(o.bad)) {
    return { ok: false, error: 'bad must be an array' }
  }

  const skippedRaw = o.skipped
  const skipped: string[] = Array.isArray(skippedRaw)
    ? skippedRaw.filter((x): x is string => typeof x === 'string')
    : []

  const good = (o.good as unknown[]).filter(isNamingEntry).map(e => ({
    id: e.id,
    name: (e.name as string).trim(),
    desc: (e.desc as string).trim()
  }))
  const bad = (o.bad as unknown[]).filter(isNamingEntry).map(e => ({
    id: e.id,
    name: (e.name as string).trim(),
    desc: (e.desc as string).trim()
  }))

  return { ok: true, value: { good, bad, skipped } }
}
