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
  Operator
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
  'streak'
])
const VALID_CONDITION_TYPES: ReadonlySet<string> = new Set([
  'and',
  'or',
  'not',
  'history',
  'currentQueue',
  'currentChampion'
])

const NAME_MIN = 2
const NAME_MAX = 7

// 明确负面的 name 词。出现在 good=true 的标签里说明 AI 把分类和命名搞反了。
// 仅检查 good 侧；坏标签允许任意调侃。
const NEGATIVE_NAME_WORDS: readonly string[] = [
  '混子',
  '翻车',
  '水货',
  '咸鱼',
  '废物',
  '掉分',
  '演员',
  '弱鸡',
  '荣鸡', // 弱鸡的变体
  '坑货',
  '送人头'
]

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
    return Array.isArray(o.ids) && o.ids.every(x => typeof x === 'number')
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

/**
 * 检测 History condition 是否存在 filter 和 refresh 同 metric + 同方向的套套逻辑。
 * 例：filter stat gold>=12000 + refresh average gold>=12000 → 必然成立 → 拒绝。
 *
 * 仅检测 average/sum/max/min refresh（count 和 streak 不会和 stat filter 冲突）。
 * 严格匹配同 metric + 同 op，避免误杀边界场景（如 filter ">= 8000" + refresh "average >= 12000"，技术上有意义）。
 */
function hasFilterRefreshTautology(history: {
  filters: MatchFilter[]
  refresh: MatchRefresh
}): boolean {
  const r = history.refresh
  if (r.type !== 'average' && r.type !== 'sum' && r.type !== 'max' && r.type !== 'min') {
    return false
  }
  for (const f of history.filters) {
    if (f.type !== 'stat') continue
    if (f.metric === r.metric && f.op === r.op) return true
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
    if (!Array.isArray(o.filters) || !o.filters.every(isMatchFilter)) return false
    if (!isMatchRefresh(o.refresh)) return false
    // 语义层兜底：拒绝 filter 和 refresh 同 metric + 同向的套套逻辑
    if (
      hasFilterRefreshTautology({
        filters: o.filters as MatchFilter[],
        refresh: o.refresh as MatchRefresh
      })
    ) {
      return false
    }
    return true
  }
  if (o.type === 'currentQueue' || o.type === 'currentChampion') {
    return Array.isArray(o.ids) && o.ids.every(x => typeof x === 'number')
  }
  return false
}

// ─── mode / desc consistency check ───────────────────────────────────────────

const RANKED_QUEUE_IDS: ReadonlySet<number> = new Set([420, 440])

/**
 * 递归收集 condition 树中所有 history filter 用到的 queue ids。
 * 返回 null 表示完全没有用 queue filter。
 */
function collectQueueIds(c: TagCondition): number[] | null {
  const out: number[] = []
  let used = false
  function walk(node: TagCondition): void {
    if (node.type === 'and' || node.type === 'or') {
      node.conditions.forEach(walk)
    } else if (node.type === 'not') {
      walk(node.condition)
    } else if (node.type === 'history') {
      for (const f of node.filters) {
        if (f.type === 'queue') {
          used = true
          out.push(...f.ids)
        }
      }
    }
    // currentQueue / currentChampion 不参与历史统计语义，跳过
  }
  walk(c)
  return used ? out : null
}

/**
 * 检查 desc 是否声明了"排位"但 filter 里含有娱乐模式 id（或同时混了排位和娱乐）。
 * - 含娱乐 id（任一非 420/440 的 queue id）且 desc 包含"排位" → 不一致 → 返回 false
 * - 没用 queue filter → 不检查，desc 怎么写都行 → 返回 true
 */
function descMatchesQueueScope(desc: string, c: TagCondition): boolean {
  const ids = collectQueueIds(c)
  if (ids === null) return true // no queue filter → desc unconstrained
  const hasNonRanked = ids.some(id => !RANKED_QUEUE_IDS.has(id))
  const descSaysRanked = desc.includes('排位')
  if (hasNonRanked && descSaysRanked) return false
  return true
}

// 召唤师峡谷专属位置词。其他模式（大乱斗、海克斯乱斗、斗魂、觉醒之战等）没有路位概念，
// name 或 desc 出现这些词就说明 AI 在套 SR 模板。
const SR_LANE_WORDS: readonly string[] = [
  '上路',
  '上单',
  '中路',
  '中单',
  '下路',
  '下单',
  'ADC',
  '打野',
  '野区',
  '辅助'
]

/**
 * 检测 text 在"非 SR 模式作用域"下是否出现路位词。
 * 仅当 filter 里所有 queue ids 全是非 ranked（即所有 id 都不在 [420, 440]）时拒绝。
 * 混合（含 ranked + 娱乐）允许，因为路位描述对 ranked 子集仍然有意义。
 */
function hasNonSrLaneWord(text: string, c: TagCondition): boolean {
  const ids = collectQueueIds(c)
  if (ids === null) return false // 没有 queue filter → 不检查
  const allNonRanked = ids.every(id => !RANKED_QUEUE_IDS.has(id))
  if (!allNonRanked) return false // 含 ranked → 路位词允许
  return SR_LANE_WORDS.some(word => text.includes(word))
}

function hasNegativeNameWord(name: string): boolean {
  return NEGATIVE_NAME_WORDS.some(w => name.includes(w))
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

  const desc = (raw.desc as string).trim()
  const name = (raw.name as string).trim()
  const cond = raw.condition as TagCondition

  // 语义层兜底：desc 模式声明必须和 filter 一致
  if (!descMatchesQueueScope(desc, cond)) return null

  // 非 SR 模式不带路位词（name 和 desc 都查）
  if (hasNonSrLaneWord(name, cond) || hasNonSrLaneWord(desc, cond)) return null

  // 好标签的 name 不能含明确负面词（name 和 good/bad 分类要语气一致）
  if (good && hasNegativeNameWord(name)) return null

  return {
    id: uuid(),
    name,
    desc,
    good,
    enabled: true,
    condition: cond,
    isDefault: false
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
