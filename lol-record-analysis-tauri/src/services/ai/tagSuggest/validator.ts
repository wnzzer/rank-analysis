/**
 * validator.ts
 *
 * AI 返回 JSON 的严格 schema 校验器。
 * 对 TagCondition / MatchFilter / MatchRefresh / Operator 做结构性验证，
 * 丢弃不合法条目并统计 droppedCount。
 */

import type {
  TagCondition,
  TagSuggestion,
  TagSuggestResult,
  MatchFilter,
  MatchRefresh,
  Operator,
} from '@renderer/types/tagSuggest'

// ─── constants ────────────────────────────────────────────────────────────────

const VALID_OPERATORS: ReadonlySet<string> = new Set(['>', '>=', '<', '<=', '==', '!='])
const VALID_STREAK_KINDS: ReadonlySet<string> = new Set(['win', 'loss'])
const VALID_FILTER_TYPES: ReadonlySet<string> = new Set(['queue', 'champion', 'stat'])
const VALID_REFRESH_TYPES: ReadonlySet<string> = new Set([
  'count',
  'average',
  'sum',
  'max',
  'min',
  'streak',
])
const VALID_CONDITION_TYPES: ReadonlySet<string> = new Set([
  'and',
  'or',
  'not',
  'history',
  'currentQueue',
  'currentChampion',
])

const NAME_MIN = 2
const NAME_MAX = 5

// ─── helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 容忍 AI 输出中前后多余文字的 fence 剥离：先尝试 ```json ... ```，再 fallback 抓首个 {...} 块。 */
function stripJsonFences(raw: string): string {
  const trimmed = raw.trim()
  // 优先：抓 ```json ... ``` 或 ``` ... ``` 之间的内容（容忍前后散文）
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenceMatch ? fenceMatch[1] : trimmed
  // 兜底：如果还有围绕的散文，抓首个 {...} 平衡块（贪婪匹配到最后一个 }）
  const objMatch = candidate.match(/\{[\s\S]*\}/)
  return objMatch ? objMatch[0] : candidate
}

function isOperator(v: unknown): v is Operator {
  return typeof v === 'string' && VALID_OPERATORS.has(v)
}

function isMatchFilter(v: unknown): v is MatchFilter {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.type !== 'string' || !VALID_FILTER_TYPES.has(o.type)) return false
  if (o.type === 'queue' || o.type === 'champion') {
    return Array.isArray(o.ids) && o.ids.every((x) => typeof x === 'number')
  }
  if (o.type === 'stat') {
    return typeof o.metric === 'string' && isOperator(o.op) && typeof o.value === 'number'
  }
  return false
}

function isMatchRefresh(v: unknown): v is MatchRefresh {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.type !== 'string' || !VALID_REFRESH_TYPES.has(o.type)) return false
  if (o.type === 'count') {
    return isOperator(o.op) && typeof o.value === 'number'
  }
  if (['average', 'sum', 'max', 'min'].includes(o.type)) {
    return typeof o.metric === 'string' && isOperator(o.op) && typeof o.value === 'number'
  }
  if (o.type === 'streak') {
    return typeof o.min === 'number' && typeof o.kind === 'string' && VALID_STREAK_KINDS.has(o.kind)
  }
  return false
}

function isTagCondition(v: unknown): v is TagCondition {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.type !== 'string' || !VALID_CONDITION_TYPES.has(o.type)) return false
  if (o.type === 'and' || o.type === 'or') {
    return Array.isArray(o.conditions) && o.conditions.every(isTagCondition)
  }
  if (o.type === 'not') {
    return isTagCondition(o.condition)
  }
  if (o.type === 'history') {
    return (
      Array.isArray(o.filters) &&
      o.filters.every(isMatchFilter) &&
      isMatchRefresh(o.refresh)
    )
  }
  if (o.type === 'currentQueue' || o.type === 'currentChampion') {
    return Array.isArray(o.ids) && o.ids.every((x) => typeof x === 'number')
  }
  return false
}

function nameOk(name: unknown): name is string {
  if (typeof name !== 'string') return false
  // 按 Unicode 字符数计算长度（正确处理中文、emoji 等多字节字符）
  const len = Array.from(name.trim()).length
  return len >= NAME_MIN && len <= NAME_MAX
}

interface RawSuggestion {
  name?: unknown
  desc?: unknown
  condition?: unknown
}

function buildSuggestion(raw: RawSuggestion, good: boolean): TagSuggestion | null {
  if (!nameOk(raw.name)) return null
  if (typeof raw.desc !== 'string' || raw.desc.trim().length === 0) return null
  if (!isTagCondition(raw.condition)) return null
  return {
    id: uuid(),
    name: (raw.name as string).trim(),
    desc: (raw.desc as string).trim(),
    good,
    enabled: true,
    condition: raw.condition,
    isDefault: false,
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * 解析并校验 AI 返回的 JSON 字符串。
 *
 * 支持裸 JSON 和 ```json ... ``` markdown 包裹两种形式。
 * 每条候选均经过 TagCondition schema 校验，不合格条目被丢弃并计入 droppedCount。
 *
 * @param raw - AI 返回的原始字符串
 * @returns 校验后的 { good, bad, droppedCount }（不含 generatedAt，由上层填充）
 * @throws 当 JSON 解析失败、或顶层缺少 good/bad 数组时抛出 Error
 */
export function parseAndValidate(raw: string): Omit<TagSuggestResult, 'generatedAt'> {
  const cleaned = stripJsonFences(raw)
  const parsed = JSON.parse(cleaned) as unknown
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('AI response is not a JSON object')
  }
  const root = parsed as { good?: unknown; bad?: unknown }
  if (!Array.isArray(root.good) || !Array.isArray(root.bad)) {
    throw new Error('AI response missing good/bad arrays')
  }

  const good: TagSuggestion[] = []
  const bad: TagSuggestion[] = []
  let droppedCount = 0

  for (const entry of root.good as RawSuggestion[]) {
    const s = buildSuggestion(entry, true)
    if (s) good.push(s)
    else droppedCount++
  }
  for (const entry of root.bad as RawSuggestion[]) {
    const s = buildSuggestion(entry, false)
    if (s) bad.push(s)
    else droppedCount++
  }

  return { good, bad, droppedCount }
}
