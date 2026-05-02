# AI 标签建议 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `AI 推荐` button to Tags 设置页 that analyzes the current user's last 20 games and proposes 2-3 "好标签" (positive patterns from wins) + 2-3 "坏标签" (negative patterns from losses) as fully-formed `TagConfig` objects the user can one-click adopt.

**Architecture:** Pure-frontend feature. Extract per-game features from the existing `get_match_history_by_puuid` Tauri command, build a prompt embedding the full `TagCondition` schema, send to the existing Cloudflare Worker AI proxy via `requestAIContent` (non-streaming with sessionStorage cache), strictly validate the AI's JSON output, render valid suggestions in a modal, and adopt by appending to the existing tag list via `save_tag_configs`. Adopted state is cached so users don't see already-adopted suggestions reappear within a session.

**Tech Stack:** TypeScript, Vue 3 + Composition API, Naive UI, Vitest, existing Cloudflare Worker proxy (`https://ai.nuliyangguang.top`), existing Tauri commands (`get_match_history_by_puuid`, `get_all_tag_configs`, `save_tag_configs`).

---

## File Structure

**New files (frontend only):**
- `lol-record-analysis-tauri/src/types/tagSuggest.ts` — TS mirror of TagConfig/TagCondition/MatchFilter/MatchRefresh/Operator/StreakType + TagSuggestion + TagSuggestResult
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/featureExtract.ts` — fetch + shape per-game features for AI input
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/prompt.ts` — system + user prompt builders
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/validator.ts` — strict TagConfig schema validation for AI output
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/index.ts` — orchestrator: fetch → prompt → AI → validate → cache; exports `requestTagSuggestions(forceRefresh)`
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/validator.spec.ts`
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/featureExtract.spec.ts`
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/prompt.spec.ts`
- `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/index.spec.ts`
- `lol-record-analysis-tauri/src/components/tags/AISuggestModal.vue`
- `lol-record-analysis-tauri/src/components/tags/__tests__/AISuggestModal.spec.ts`

**Modified files:**
- `lol-record-analysis-tauri/src/views/settings/Tags.vue` — add `AI 推荐` button + mount AISuggestModal

**No Rust changes.** All schemas (TagConfig, TagCondition, etc.) already exist in `src-tauri/src/command/user_tag_config.rs`. Tauri commands `get_match_history_by_puuid`, `get_all_tag_configs`, `save_tag_configs` already exist.

---

## Critical schema reference (to embed in prompt and mirror in TS)

From `src-tauri/src/command/user_tag_config.rs`:

```rust
// Operator: serialized as STRING SYMBOLS (not enum names)
#[serde(rename = ">")]  Gt
#[serde(rename = ">=")] Gte
#[serde(rename = "<")]  Lt
#[serde(rename = "<=")] Lte
#[serde(rename = "==")] Eq
#[serde(rename = "!=")] Neq

// StreakType: camelCase variants
"win" | "loss"

// MatchFilter: tagged-union, type field is camelCase
{ type: "queue", ids: number[] }
{ type: "champion", ids: number[] }
{ type: "stat", metric: string, op: Operator, value: number }

// MatchRefresh: tagged-union, type field is camelCase
{ type: "count", op: Operator, value: number }
{ type: "average", metric: string, op: Operator, value: number }
{ type: "sum", metric: string, op: Operator, value: number }
{ type: "max", metric: string, op: Operator, value: number }
{ type: "min", metric: string, op: Operator, value: number }
{ type: "streak", min: number, kind: "win" | "loss" }

// TagCondition: tagged-union, type field is camelCase
{ type: "and", conditions: TagCondition[] }
{ type: "or", conditions: TagCondition[] }
{ type: "not", condition: TagCondition }
{ type: "history", filters: MatchFilter[], refresh: MatchRefresh }
{ type: "currentQueue", ids: number[] }
{ type: "currentChampion", ids: number[] }

// TagConfig (top-level)
{ id: string, name: string, desc: string, good: boolean, enabled: boolean, condition: TagCondition, isDefault: boolean }
```

**Common metrics for `Stat` / `Average` / etc.**: `kills`, `deaths`, `assists`, `kda`, `damage`, `gold` (per `extractPlayerDeepDive`).

**Common queue IDs:** 420 (单双排), 440 (灵活组排), 430 (匹配), 450 (大乱斗).

---

## Task 1: TS type mirror

**Files:**
- Create: `lol-record-analysis-tauri/src/types/tagSuggest.ts`

- [ ] **Step 1: Write the file**

```typescript
/**
 * AI 标签建议相关的 TypeScript 类型，与 Rust schema
 * (src-tauri/src/command/user_tag_config.rs) 严格同构。
 *
 * Operator 序列化为字符串符号（"<", ">=" 等），不是枚举名。
 */

export type Operator = '>' | '>=' | '<' | '<=' | '==' | '!='
export type StreakType = 'win' | 'loss'

export type MatchFilter =
  | { type: 'queue'; ids: number[] }
  | { type: 'champion'; ids: number[] }
  | { type: 'stat'; metric: string; op: Operator; value: number }

export type MatchRefresh =
  | { type: 'count'; op: Operator; value: number }
  | { type: 'average'; metric: string; op: Operator; value: number }
  | { type: 'sum'; metric: string; op: Operator; value: number }
  | { type: 'max'; metric: string; op: Operator; value: number }
  | { type: 'min'; metric: string; op: Operator; value: number }
  | { type: 'streak'; min: number; kind: StreakType }

export type TagCondition =
  | { type: 'and'; conditions: TagCondition[] }
  | { type: 'or'; conditions: TagCondition[] }
  | { type: 'not'; condition: TagCondition }
  | { type: 'history'; filters: MatchFilter[]; refresh: MatchRefresh }
  | { type: 'currentQueue'; ids: number[] }
  | { type: 'currentChampion'; ids: number[] }

export interface TagConfig {
  id: string
  name: string
  desc: string
  good: boolean
  enabled: boolean
  condition: TagCondition
  isDefault: boolean
}

/** AI 输出的单条候选（采用前/后），叠加 adopted 状态用于 UI 灰态。 */
export type TagSuggestion = TagConfig & { adopted?: boolean }

export interface TagSuggestResult {
  good: TagSuggestion[]
  bad: TagSuggestion[]
  droppedCount: number
  generatedAt: string // ISO timestamp
}
```

- [ ] **Step 2: Typecheck**

```bash
cd lol-record-analysis-tauri
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/wnzzer/rank-analysis
git add lol-record-analysis-tauri/src/types/tagSuggest.ts
git commit -m "feat: 增加 AI 标签建议的前端类型定义"
```

---

## Task 2: Validator (strict schema check on AI output)

**Files:**
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/validator.ts`
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/validator.spec.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
// validator.spec.ts
import { describe, it, expect } from 'vitest'
import { parseAndValidate } from '../validator'

describe('parseAndValidate', () => {
  function suggestion(overrides: Partial<{ name: string; desc: string }> = {}) {
    return {
      name: '中路雕将',
      desc: '中路场均 KDA 高',
      condition: {
        type: 'history',
        filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
        refresh: { type: 'count', op: '>=', value: 5 },
      },
      ...overrides,
    }
  }

  it('extracts wrapped json from markdown fences', () => {
    const raw = '```json\n{"good":[],"bad":[]}\n```'
    const r = parseAndValidate(raw)
    expect(r.good).toEqual([])
    expect(r.bad).toEqual([])
  })

  it('drops entry whose name is too short', () => {
    const raw = JSON.stringify({ good: [suggestion({ name: '中' })], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(0)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry whose name is too long', () => {
    const raw = JSON.stringify({ good: [suggestion({ name: '中路雕将猛人' })], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry missing condition', () => {
    const bad = { name: '中路雕将', desc: 'x' } // no condition
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry with invalid TagCondition variant', () => {
    const bad = suggestion()
    bad.condition = { type: 'bogusVariant' } as never
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('drops entry with invalid Operator string', () => {
    const bad = suggestion()
    ;(bad.condition as any).filters[0].op = 'GTE' // wrong (should be ">=")
    const raw = JSON.stringify({ good: [bad], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.droppedCount).toBe(1)
  })

  it('preserves valid entries from a mixed batch', () => {
    const raw = JSON.stringify({
      good: [suggestion(), suggestion({ name: '中' })],
      bad: [suggestion()],
    })
    const r = parseAndValidate(raw)
    expect(r.good).toHaveLength(1)
    expect(r.bad).toHaveLength(1)
    expect(r.droppedCount).toBe(1)
  })

  it('throws on JSON parse failure', () => {
    expect(() => parseAndValidate('not json')).toThrow()
  })

  it('throws when payload lacks good/bad arrays', () => {
    expect(() => parseAndValidate('{"foo": []}')).toThrow()
  })

  it('fills good=true/false based on which array the entry came from', () => {
    const raw = JSON.stringify({ good: [suggestion()], bad: [suggestion()] })
    const r = parseAndValidate(raw)
    expect(r.good[0].good).toBe(true)
    expect(r.bad[0].good).toBe(false)
  })

  it('generates id (uuid) and sets isDefault=false / enabled=true', () => {
    const raw = JSON.stringify({ good: [suggestion()], bad: [] })
    const r = parseAndValidate(raw)
    expect(r.good[0].id).toMatch(/[a-f0-9-]+/)
    expect(r.good[0].isDefault).toBe(false)
    expect(r.good[0].enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd lol-record-analysis-tauri
npm run test -- validator
```

Expected: file not found / function not defined.

- [ ] **Step 3: Implement the validator**

```typescript
// validator.ts
import type {
  TagCondition,
  TagSuggestion,
  TagSuggestResult,
  MatchFilter,
  MatchRefresh,
  Operator,
} from '@renderer/types/tagSuggest'

const VALID_OPERATORS: ReadonlySet<string> = new Set(['>', '>=', '<', '<=', '==', '!='])
const VALID_STREAK_KINDS: ReadonlySet<string> = new Set(['win', 'loss'])
const VALID_FILTER_TYPES: ReadonlySet<string> = new Set(['queue', 'champion', 'stat'])
const VALID_REFRESH_TYPES: ReadonlySet<string> = new Set([
  'count', 'average', 'sum', 'max', 'min', 'streak',
])
const VALID_CONDITION_TYPES: ReadonlySet<string> = new Set([
  'and', 'or', 'not', 'history', 'currentQueue', 'currentChampion',
])

const NAME_MIN = 2
const NAME_MAX = 5

function uuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 剥掉 ```json ... ``` markdown 包裹（如果有），返回纯 JSON 字符串。 */
function stripJsonFences(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return trimmed
  const lines = trimmed.split('\n')
  // 去掉第一行 ```json 和最后一行 ```
  return lines.slice(1, -1).join('\n')
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
    return typeof o.min === 'number' &&
      typeof o.kind === 'string' &&
      VALID_STREAK_KINDS.has(o.kind)
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
    return Array.isArray(o.filters) && o.filters.every(isMatchFilter) && isMatchRefresh(o.refresh)
  }
  if (o.type === 'currentQueue' || o.type === 'currentChampion') {
    return Array.isArray(o.ids) && o.ids.every(x => typeof x === 'number')
  }
  return false
}

function nameOk(name: unknown): name is string {
  if (typeof name !== 'string') return false
  // 2-5 中文字符（实测包含 ASCII 也接受，长度限制为字符数）
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

/**
 * 解析 + 校验 AI 返回的 JSON。
 * 返回 { good, bad, droppedCount }；good 和 bad 数组中的 entry 都已通过 schema 校验。
 *
 * @throws 当 JSON 解析失败、或顶层缺 good/bad 数组时
 */
export function parseAndValidate(raw: string): Omit<TagSuggestResult, 'generatedAt'> {
  const cleaned = stripJsonFences(raw)
  const parsed = JSON.parse(cleaned) as { good?: unknown; bad?: unknown }
  if (!Array.isArray(parsed.good) || !Array.isArray(parsed.bad)) {
    throw new Error('AI response missing good/bad arrays')
  }

  const good: TagSuggestion[] = []
  const bad: TagSuggestion[] = []
  let droppedCount = 0

  for (const raw of parsed.good as RawSuggestion[]) {
    const s = buildSuggestion(raw, true)
    if (s) good.push(s)
    else droppedCount++
  }
  for (const raw of parsed.bad as RawSuggestion[]) {
    const s = buildSuggestion(raw, false)
    if (s) bad.push(s)
    else droppedCount++
  }

  return { good, bad, droppedCount }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- validator
```

Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src/services/ai/tagSuggest/validator.ts \
        lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/validator.spec.ts
git commit -m "feat: AI 标签建议输出严格校验器 + 11 单元测试"
```

---

## Task 3: Game feature extraction

**Files:**
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/featureExtract.ts`
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/featureExtract.spec.ts`

- [ ] **Step 1: Tests first**

```typescript
import { describe, it, expect } from 'vitest'
import { gameToFeature, splitWinsLosses } from '../featureExtract'

describe('gameToFeature', () => {
  it('extracts core fields from a participant', () => {
    const game = {
      gameId: 1,
      queueId: 420,
      gameDuration: 1800, // 30 min
      participants: [
        {
          championId: 157,
          stats: {
            win: true,
            kills: 10,
            deaths: 2,
            assists: 8,
            totalDamageDealtToChampions: 30000,
            goldEarned: 12000,
          },
        },
      ],
      participantIdentities: [{ player: { puuid: 'me' } }],
    }
    const f = gameToFeature(game, 'me')
    expect(f).toMatchObject({
      championId: 157,
      win: true,
      kda: { k: 10, d: 2, a: 8 },
      queueId: 420,
      durationMin: 30,
    })
    expect(f.kda.ratio).toBeCloseTo(9, 1)
  })

  it('handles 0 deaths without divide-by-zero', () => {
    const game = {
      gameId: 1,
      queueId: 420,
      gameDuration: 1500,
      participants: [
        { championId: 1, stats: { win: true, kills: 5, deaths: 0, assists: 3 } },
      ],
      participantIdentities: [{ player: { puuid: 'me' } }],
    }
    const f = gameToFeature(game, 'me')
    expect(Number.isFinite(f.kda.ratio)).toBe(true)
    expect(f.kda.ratio).toBe(8) // (5+3)/1 — convention: deaths=0 → use 1
  })

  it('returns null when puuid not in game', () => {
    const game = {
      gameId: 1,
      queueId: 420,
      gameDuration: 1500,
      participants: [{ championId: 1, stats: { win: true, kills: 0, deaths: 0, assists: 0 } }],
      participantIdentities: [{ player: { puuid: 'someone-else' } }],
    }
    expect(gameToFeature(game, 'me')).toBeNull()
  })
})

describe('splitWinsLosses', () => {
  it('partitions by win field', () => {
    const features = [
      { win: true, championId: 1 },
      { win: false, championId: 2 },
      { win: true, championId: 3 },
    ] as any
    const { wins, losses } = splitWinsLosses(features)
    expect(wins).toHaveLength(2)
    expect(losses).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Verify failing**

```bash
npm run test -- featureExtract
```

Expected: file not found.

- [ ] **Step 3: Implement**

```typescript
// featureExtract.ts
/**
 * AI 标签建议的输入特征提取：把 LCU 对局原始数据压成喂给 AI 的精简结构。
 */

export interface GameFeature {
  win: boolean
  championId: number
  queueId: number
  durationMin: number
  kda: { k: number; d: number; a: number; ratio: number }
  damage: number
  gold: number
}

interface RawParticipantStats {
  win?: boolean
  kills?: number
  deaths?: number
  assists?: number
  totalDamageDealtToChampions?: number
  goldEarned?: number
}

interface RawParticipant {
  championId?: number
  stats?: RawParticipantStats
}

interface RawIdentity {
  player?: { puuid?: string }
}

export interface RawGame {
  gameId: number
  queueId: number
  gameDuration: number // seconds
  participants: RawParticipant[]
  participantIdentities: RawIdentity[]
}

/**
 * 提取一场对局中指定玩家的特征。puuid 不在该场中时返回 null。
 *
 * 约定：deaths=0 时按 1 处理（避免除零、保持 KDA 仍可比较）。
 */
export function gameToFeature(game: RawGame, myPuuid: string): GameFeature | null {
  const idx = game.participantIdentities.findIndex(i => i.player?.puuid === myPuuid)
  if (idx < 0) return null
  const p = game.participants[idx]
  if (!p) return null
  const s = p.stats ?? {}
  const k = s.kills ?? 0
  const d = s.deaths ?? 0
  const a = s.assists ?? 0
  const dForRatio = d === 0 ? 1 : d
  return {
    win: s.win ?? false,
    championId: p.championId ?? 0,
    queueId: game.queueId,
    durationMin: Math.round(game.gameDuration / 60),
    kda: { k, d, a, ratio: (k + a) / dForRatio },
    damage: s.totalDamageDealtToChampions ?? 0,
    gold: s.goldEarned ?? 0,
  }
}

export function splitWinsLosses(features: GameFeature[]): {
  wins: GameFeature[]
  losses: GameFeature[]
} {
  const wins: GameFeature[] = []
  const losses: GameFeature[] = []
  for (const f of features) {
    if (f.win) wins.push(f)
    else losses.push(f)
  }
  return { wins, losses }
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- featureExtract
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src/services/ai/tagSuggest/featureExtract.ts \
        lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/featureExtract.spec.ts
git commit -m "feat: AI 标签建议的对局特征提取器 + 4 单元测试"
```

---

## Task 4: Prompt builder

**Files:**
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/prompt.ts`
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/prompt.spec.ts`

- [ ] **Step 1: Tests first**

```typescript
import { describe, it, expect } from 'vitest'
import { buildTagSuggestPrompt, SYSTEM_PROMPT } from '../prompt'

describe('SYSTEM_PROMPT', () => {
  it('embeds the full TagCondition schema reference', () => {
    expect(SYSTEM_PROMPT).toContain('"type": "history"')
    expect(SYSTEM_PROMPT).toContain('"type": "currentQueue"')
    expect(SYSTEM_PROMPT).toContain('"type": "stat"')
  })
  it('embeds the Operator string symbols', () => {
    expect(SYSTEM_PROMPT).toContain('">="')
    expect(SYSTEM_PROMPT).toContain('"<"')
  })
  it('mentions the 2-5 character name constraint', () => {
    expect(SYSTEM_PROMPT).toContain('2-5')
  })
  it('demands strict JSON output without markdown', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('json')
    expect(SYSTEM_PROMPT).toContain('good')
    expect(SYSTEM_PROMPT).toContain('bad')
  })
})

describe('buildTagSuggestPrompt', () => {
  it('reports the actual N for wins and losses', () => {
    const wins = [{ win: true } as any, { win: true } as any]
    const losses = [{ win: false } as any]
    const p = buildTagSuggestPrompt(wins, losses)
    expect(p).toContain('赢局 (N=2)')
    expect(p).toContain('输局 (N=1)')
  })
  it('handles N=0 wins (all losses)', () => {
    const p = buildTagSuggestPrompt([], [{ win: false } as any])
    expect(p).toContain('赢局 (N=0)')
  })
  it('embeds JSON of features, not raw text', () => {
    const wins = [{ win: true, championId: 157, kda: { ratio: 5 } } as any]
    const p = buildTagSuggestPrompt(wins, [])
    expect(p).toContain('"championId": 157')
    expect(p).toContain('"ratio": 5')
  })
})
```

- [ ] **Step 2: Verify failing**

```bash
npm run test -- prompt
```

- [ ] **Step 3: Implement**

```typescript
// prompt.ts
import type { GameFeature } from './featureExtract'

export const SYSTEM_PROMPT = `你是英雄联盟数据分析助手。任务：分析用户近 N 场对局，找赢局和输局的共同模式，提取为可复用的玩家标签规则（TagConfig 结构）。

约束：
- 标签名 2-5 字，儒雅古风（参考"中路雕将"、"暮气沉沉"），避免俗套（如"carry王"、"演员"、"送人头"）
- 好标签 2-3 个，源自"赢局"共同点；坏标签 2-3 个，源自"输局"共同点
- 单条规则在样本中必须 ≥3 局命中，避免过拟合
- desc 字段一句话说清楚命中条件（10-30 字）
- condition 严格符合 TagCondition schema，不允许多余字段
- 不要在输出外裹 markdown 代码块；直接返回 JSON

TagCondition schema（type 字段是 camelCase；Operator 是字符串符号）：

{ "type": "and", "conditions": [TagCondition...] }
{ "type": "or", "conditions": [TagCondition...] }
{ "type": "not", "condition": TagCondition }
{ "type": "history", "filters": [MatchFilter...], "refresh": MatchRefresh }
{ "type": "currentQueue", "ids": [int...] }
{ "type": "currentChampion", "ids": [int...] }

MatchFilter:
{ "type": "queue", "ids": [int...] }
{ "type": "champion", "ids": [int...] }
{ "type": "stat", "metric": "kills"|"deaths"|"assists"|"kda"|"damage"|"gold", "op": ">"|">="|"<"|"<="|"=="|"!=", "value": number }

MatchRefresh:
{ "type": "count", "op": Operator, "value": number }
{ "type": "average", "metric": string, "op": Operator, "value": number }
{ "type": "sum", "metric": string, "op": Operator, "value": number }
{ "type": "max"|"min", "metric": string, "op": Operator, "value": number }
{ "type": "streak", "min": int, "kind": "win"|"loss" }

输出严格 JSON：
{
  "good": [
    { "name": "...", "desc": "...", "condition": TagCondition },
    ...
  ],
  "bad": [
    { "name": "...", "desc": "...", "condition": TagCondition },
    ...
  ]
}`

export function buildTagSuggestPrompt(wins: GameFeature[], losses: GameFeature[]): string {
  return [
    `赢局 (N=${wins.length}):`,
    JSON.stringify(wins, null, 2),
    '',
    `输局 (N=${losses.length}):`,
    JSON.stringify(losses, null, 2),
  ].join('\n')
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- prompt
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src/services/ai/tagSuggest/prompt.ts \
        lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/prompt.spec.ts
git commit -m "feat: AI 标签建议的 prompt 构造器（系统 + 用户消息）+ 6 测试"
```

---

## Task 5: Orchestrator + cache

**Files:**
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/index.ts`
- Create: `lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/index.spec.ts`

⚠️ **About fetching the user's match history:** `get_match_history_by_puuid(puuid: string, beg_index: number, end_index: number)` is the existing Tauri command. To get the current user's puuid, use `Summoner::get_my_summoner` — but that's a Rust call. The frontend pattern for this varies; the cleanest way:

Look at `lol-record-analysis-tauri/src/composables/useSessionSync.ts` (or similar) for how the current user's puuid is exposed to the frontend. If a Pinia store / composable already holds the current user, use it. If not, call `invoke('get_my_summoner')` directly. For this task we'll abstract via a `getCurrentUserPuuid()` helper that you should wire to whatever exists.

- [ ] **Step 1: Tests first** (use vitest mocking for invoke + requestAIContent)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be hoisted before the import
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@renderer/services/ai/stream', () => ({
  requestAIContent: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { requestAIContent } from '@renderer/services/ai/stream'
import { requestTagSuggestions, MIN_GAMES_REQUIRED, getCacheKey } from '../index'

const fakeGoodAIResponse = JSON.stringify({
  good: [
    {
      name: '中路雕将',
      desc: '中路场均 KDA ≥ 5',
      condition: {
        type: 'history',
        filters: [{ type: 'stat', metric: 'kda', op: '>=', value: 5 }],
        refresh: { type: 'count', op: '>=', value: 3 },
      },
    },
  ],
  bad: [],
})

function fakeGame(win: boolean, puuid = 'me') {
  return {
    gameId: Math.random(),
    queueId: 420,
    gameDuration: 1800,
    participants: [{ championId: 1, stats: { win, kills: 5, deaths: 1, assists: 3 } }],
    participantIdentities: [{ player: { puuid } }],
  }
}

beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('requestTagSuggestions', () => {
  it('returns insufficient when game count < MIN_GAMES_REQUIRED', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: [fakeGame(true)] } } // only 1 game
      }
      throw new Error('unexpected: ' + cmd)
    })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') expect(r.gameCount).toBe(1)
  })

  it('hits AI and parses on first call', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return {
          games: {
            games: Array.from({ length: 10 }, () => fakeGame(true)),
          },
        }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.result.good).toHaveLength(1)
      expect(r.result.good[0].name).toBe('中路雕将')
    }
  })

  it('uses cache on second call (no second AI fetch)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    await requestTagSuggestions()
    await requestTagSuggestions()
    expect(vi.mocked(requestAIContent)).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh bypasses cache', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: fakeGoodAIResponse })

    await requestTagSuggestions()
    await requestTagSuggestions(true)
    expect(vi.mocked(requestAIContent)).toHaveBeenCalledTimes(2)
  })

  it('returns aiError when requestAIContent fails', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: false, error: 'network down' })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('aiError')
    if (r.kind === 'aiError') expect(r.error).toContain('network')
  })

  it('returns parseError when JSON is malformed', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_match_history_by_puuid') {
        return { games: { games: Array.from({ length: 10 }, () => fakeGame(true)) } }
      }
      throw new Error('unexpected: ' + cmd)
    })
    vi.mocked(requestAIContent).mockResolvedValue({ success: true, content: 'not json' })

    const r = await requestTagSuggestions()
    expect(r.kind).toBe('parseError')
  })
})

describe('cache key', () => {
  it('keys by puuid', () => {
    expect(getCacheKey('me')).toBe('ai_tag_suggest_me')
  })
})
```

- [ ] **Step 2: Verify failing**

```bash
npm run test -- 'tagSuggest/__tests__/index'
```

- [ ] **Step 3: Implement**

```typescript
// index.ts
import { invoke } from '@tauri-apps/api/core'
import { requestAIContent } from '@renderer/services/ai/stream'
import type { TagSuggestion, TagSuggestResult } from '@renderer/types/tagSuggest'
import { gameToFeature, splitWinsLosses, type RawGame } from './featureExtract'
import { buildTagSuggestPrompt, SYSTEM_PROMPT } from './prompt'
import { parseAndValidate } from './validator'

export const MIN_GAMES_REQUIRED = 5
export const MAX_GAMES_FETCHED = 20

export type TagSuggestOutcome =
  | { kind: 'ok'; result: TagSuggestResult }
  | { kind: 'insufficient'; gameCount: number }
  | { kind: 'aiError'; error: string }
  | { kind: 'parseError'; error: string }

export function getCacheKey(puuid: string): string {
  return `ai_tag_suggest_${puuid}`
}

interface MyTagSuggestCache {
  good: TagSuggestion[]
  bad: TagSuggestion[]
  droppedCount: number
  generatedAt: string
}

function readCache(puuid: string): MyTagSuggestCache | null {
  try {
    const raw = sessionStorage.getItem(getCacheKey(puuid))
    if (!raw) return null
    return JSON.parse(raw) as MyTagSuggestCache
  } catch {
    return null
  }
}

function writeCache(puuid: string, cache: MyTagSuggestCache): void {
  try {
    sessionStorage.setItem(getCacheKey(puuid), JSON.stringify(cache))
  } catch {
    // ignore (private mode / quota)
  }
}

/** Mark an adopted suggestion in cache so it stays grayed out across modal opens. */
export function markAdopted(puuid: string, suggestionId: string): void {
  const c = readCache(puuid)
  if (!c) return
  for (const s of [...c.good, ...c.bad]) {
    if (s.id === suggestionId) s.adopted = true
  }
  writeCache(puuid, c)
}

async function getCurrentUserPuuid(): Promise<string> {
  const summoner = await invoke<{ puuid: string }>('get_my_summoner')
  return summoner.puuid
}

interface RawMatchHistoryResponse {
  games?: { games?: RawGame[] }
}

async function fetchRecentGames(puuid: string): Promise<RawGame[]> {
  const resp = await invoke<RawMatchHistoryResponse>('get_match_history_by_puuid', {
    puuid,
    begIndex: 0,
    endIndex: MAX_GAMES_FETCHED - 1,
  })
  return resp.games?.games ?? []
}

/**
 * Top-level entry point — Tags.vue's AISuggestModal calls this.
 *
 * @param forceRefresh true to bypass cache and re-fetch from AI
 */
export async function requestTagSuggestions(forceRefresh = false): Promise<TagSuggestOutcome> {
  const puuid = await getCurrentUserPuuid()

  if (!forceRefresh) {
    const cached = readCache(puuid)
    if (cached) {
      return {
        kind: 'ok',
        result: {
          good: cached.good,
          bad: cached.bad,
          droppedCount: cached.droppedCount,
          generatedAt: cached.generatedAt,
        },
      }
    }
  }

  const rawGames = await fetchRecentGames(puuid)
  const features = rawGames
    .map(g => gameToFeature(g, puuid))
    .filter((f): f is NonNullable<typeof f> => f !== null)

  if (features.length < MIN_GAMES_REQUIRED) {
    return { kind: 'insufficient', gameCount: features.length }
  }

  const { wins, losses } = splitWinsLosses(features)
  const userPrompt = buildTagSuggestPrompt(wins, losses)
  const cacheKey = `ai_tag_suggest_raw_${puuid}_${Date.now()}` // fresh raw cache per call (forceRefresh path)

  const aiResp = await requestAIContent(userPrompt, cacheKey, SYSTEM_PROMPT)
  if (!aiResp.success) {
    return { kind: 'aiError', error: aiResp.error ?? 'unknown AI error' }
  }

  let parsed
  try {
    parsed = parseAndValidate(aiResp.content)
  } catch (e) {
    return { kind: 'parseError', error: (e as Error).message }
  }

  const cache: MyTagSuggestCache = {
    good: parsed.good,
    bad: parsed.bad,
    droppedCount: parsed.droppedCount,
    generatedAt: new Date().toISOString(),
  }
  writeCache(puuid, cache)

  return {
    kind: 'ok',
    result: {
      good: cache.good,
      bad: cache.bad,
      droppedCount: cache.droppedCount,
      generatedAt: cache.generatedAt,
    },
  }
}
```

⚠️ **Verify the Tauri command param shape:** In Step 3 above I used `{ puuid, begIndex, endIndex }` (camelCase). Tauri serializes JS args by converting camelCase to snake_case for Rust by default. Look at how an existing frontend caller invokes `get_match_history_by_puuid` (e.g., grep `'get_match_history_by_puuid'` in `src/`) and match the casing exactly.

- [ ] **Step 4: Run tests**

```bash
npm run test -- 'tagSuggest/__tests__/index'
```

Expected: 7 tests pass (6 outcome scenarios + 1 cache key).

- [ ] **Step 5: Commit**

```bash
git add lol-record-analysis-tauri/src/services/ai/tagSuggest/index.ts \
        lol-record-analysis-tauri/src/services/ai/tagSuggest/__tests__/index.spec.ts
git commit -m "feat: AI 标签建议编排器（fetch + AI + 缓存）+ 7 单元测试"
```

---

## Task 6: AISuggestModal.vue

**Files:**
- Create: `lol-record-analysis-tauri/src/components/tags/AISuggestModal.vue`

- [ ] **Step 1: Write the component**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { NModal, NCard, NButton, NSpace, NText, NTag, NEmpty, NSpin } from 'naive-ui'
import {
  requestTagSuggestions,
  markAdopted,
  type TagSuggestOutcome,
} from '@renderer/services/ai/tagSuggest'
import type { TagSuggestion, TagConfig } from '@renderer/types/tagSuggest'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'adopted'): void  // tells Tags.vue to refresh its list
}>()

const loading = ref(false)
const outcome = ref<TagSuggestOutcome | null>(null)
const adoptingIds = ref<Set<string>>(new Set())

async function load(forceRefresh = false) {
  loading.value = true
  try {
    outcome.value = await requestTagSuggestions(forceRefresh)
  } catch (e) {
    outcome.value = { kind: 'aiError', error: (e as Error).message }
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  isShown => {
    if (isShown && outcome.value === null) {
      void load(false)
    }
  },
  { immediate: true }
)

async function adopt(s: TagSuggestion) {
  if (adoptingIds.value.has(s.id)) return
  adoptingIds.value.add(s.id)
  try {
    const existing = await invoke<TagConfig[]>('get_all_tag_configs')
    // Strip adopted marker before saving
    const { adopted: _adopted, ...clean } = s
    await invoke('save_tag_configs', { configs: [...existing, clean] })

    // Get puuid for cache update
    const summoner = await invoke<{ puuid: string }>('get_my_summoner')
    markAdopted(summoner.puuid, s.id)

    // Reflect adopted state in current view
    if (outcome.value?.kind === 'ok') {
      const tagged = outcome.value.result.good.find(x => x.id === s.id)
      if (tagged) tagged.adopted = true
      const tagged2 = outcome.value.result.bad.find(x => x.id === s.id)
      if (tagged2) tagged2.adopted = true
    }
    emit('adopted')
  } catch (e) {
    console.error('采用标签失败', e)
  } finally {
    adoptingIds.value.delete(s.id)
  }
}

function close() {
  emit('update:show', false)
}
</script>

<template>
  <n-modal :show="show" @update:show="close">
    <n-card style="width: 720px; max-height: 80vh; overflow: auto" title="AI 看了你最近 20 把">
      <template #header-extra>
        <n-button size="small" @click="load(true)" :loading="loading">🔄 重新生成</n-button>
      </template>

      <div v-if="loading" style="padding: 40px; text-align: center">
        <n-spin />
        <div style="margin-top: 12px; color: var(--n-text-color-disabled)">AI 分析中（约 5-10s）</div>
      </div>

      <div v-else-if="outcome?.kind === 'insufficient'">
        <n-empty :description="`近期对局太少（${outcome.gameCount} 局），打几局再来`" />
      </div>

      <div v-else-if="outcome?.kind === 'aiError'">
        <n-empty description="AI 暂时不可用">
          <template #extra>
            <n-button @click="load(true)">重试</n-button>
            <n-text depth="3" style="display: block; margin-top: 8px; font-size: 12px">
              {{ outcome.error }}
            </n-text>
          </template>
        </n-empty>
      </div>

      <div v-else-if="outcome?.kind === 'parseError'">
        <n-empty description="AI 输出格式异常，点重新生成">
          <template #extra>
            <n-button @click="load(true)">重新生成</n-button>
          </template>
        </n-empty>
      </div>

      <div v-else-if="outcome?.kind === 'ok'">
        <n-text v-if="outcome.result.droppedCount > 0" depth="3" style="font-size: 12px">
          AI 产出 {{ outcome.result.good.length + outcome.result.bad.length + outcome.result.droppedCount }} 条建议，{{ outcome.result.droppedCount }} 条无效已过滤
        </n-text>

        <div v-if="outcome.result.good.length === 0 && outcome.result.bad.length === 0">
          <n-empty description="这次没产出有效建议">
            <template #extra><n-button @click="load(true)">重新生成</n-button></template>
          </n-empty>
        </div>

        <template v-else>
          <div class="section-title" style="margin-top: 16px">好标签（赢局共同点）</div>
          <n-space v-if="outcome.result.good.length > 0">
            <n-card
              v-for="s in outcome.result.good"
              :key="s.id"
              size="small"
              style="width: 220px"
              :style="s.adopted ? 'opacity: 0.5' : ''"
            >
              <n-tag type="success" size="small" round>{{ s.name }}</n-tag>
              <div style="margin-top: 8px; font-size: 12px; color: var(--n-text-color-2)">
                {{ s.desc }}
              </div>
              <n-button
                size="small"
                type="primary"
                style="margin-top: 8px; width: 100%"
                :disabled="s.adopted || adoptingIds.has(s.id)"
                :loading="adoptingIds.has(s.id)"
                @click="adopt(s)"
              >
                {{ s.adopted ? '已采用' : '采用' }}
              </n-button>
            </n-card>
          </n-space>
          <div v-else style="color: var(--n-text-color-disabled); font-size: 12px">
            无（最近没有赢局）
          </div>

          <div class="section-title" style="margin-top: 24px">坏标签（输局共同点）</div>
          <n-space v-if="outcome.result.bad.length > 0">
            <n-card
              v-for="s in outcome.result.bad"
              :key="s.id"
              size="small"
              style="width: 220px"
              :style="s.adopted ? 'opacity: 0.5' : ''"
            >
              <n-tag type="error" size="small" round>{{ s.name }}</n-tag>
              <div style="margin-top: 8px; font-size: 12px; color: var(--n-text-color-2)">
                {{ s.desc }}
              </div>
              <n-button
                size="small"
                type="primary"
                style="margin-top: 8px; width: 100%"
                :disabled="s.adopted || adoptingIds.has(s.id)"
                :loading="adoptingIds.has(s.id)"
                @click="adopt(s)"
              >
                {{ s.adopted ? '已采用' : '采用' }}
              </n-button>
            </n-card>
          </n-space>
          <div v-else style="color: var(--n-text-color-disabled); font-size: 12px">
            无（最近没有输局）
          </div>
        </template>
      </div>
    </n-card>
  </n-modal>
</template>

<style scoped>
.section-title {
  font-weight: 600;
  margin-bottom: 8px;
}
</style>
```

- [ ] **Step 2: Typecheck + lint**

```bash
cd lol-record-analysis-tauri
npm run typecheck
npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lol-record-analysis-tauri/src/components/tags/AISuggestModal.vue
git commit -m "feat: AISuggestModal — 展示 + 采用 + 重新生成"
```

---

## Task 7: AISuggestModal component test

**Files:**
- Create: `lol-record-analysis-tauri/src/components/tags/__tests__/AISuggestModal.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@renderer/services/ai/tagSuggest', () => ({
  requestTagSuggestions: vi.fn(),
  markAdopted: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { requestTagSuggestions } from '@renderer/services/ai/tagSuggest'
import AISuggestModal from '../AISuggestModal.vue'

const stubs = {
  Modal: { template: '<div><slot /></div>' },
  Card: { template: '<div><slot /><slot name="header-extra" /></div>' },
  Button: { template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\')"><slot /></button>' },
  Tag: { template: '<span><slot /></span>' },
  Space: { template: '<div><slot /></div>' },
  Spin: { template: '<div>spinning</div>' },
  Empty: { template: '<div><slot /><slot name="extra" /></div>' },
  Text: { template: '<span><slot /></span>' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AISuggestModal', () => {
  it('shows insufficient state when game count < 5', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({ kind: 'insufficient', gameCount: 3 })
    const w = mount(AISuggestModal, {
      props: { show: true },
      global: { stubs },
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('近期对局太少')
  })

  it('shows ok results with good/bad cards', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({
      kind: 'ok',
      result: {
        good: [{ id: 'g1', name: '中路雕将', desc: 'ok', good: true, enabled: true,
                 condition: { type: 'currentQueue', ids: [420] }, isDefault: false }],
        bad: [{ id: 'b1', name: '兵线漂泊', desc: 'bad', good: false, enabled: true,
                condition: { type: 'currentQueue', ids: [420] }, isDefault: false }],
        droppedCount: 0,
        generatedAt: '2026-05-02T00:00:00Z',
      },
    } as any)
    const w = mount(AISuggestModal, { props: { show: true }, global: { stubs } })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('中路雕将')
    expect(w.text()).toContain('兵线漂泊')
  })

  it('adopt calls save_tag_configs with merged list', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({
      kind: 'ok',
      result: {
        good: [{ id: 'g1', name: '中路雕将', desc: 'd', good: true, enabled: true,
                 condition: { type: 'currentQueue', ids: [420] }, isDefault: false }],
        bad: [],
        droppedCount: 0,
        generatedAt: '2026-05-02',
      },
    } as any)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_all_tag_configs') return [{ id: 'existing', name: 'X' }]
      if (cmd === 'save_tag_configs') return undefined
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      throw new Error('unexpected: ' + cmd)
    })
    const w = mount(AISuggestModal, { props: { show: true }, global: { stubs } })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    const adoptBtn = w.findAll('button').find(b => b.text().trim() === '采用')!
    await adoptBtn.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('save_tag_configs', expect.objectContaining({
      configs: expect.arrayContaining([
        expect.objectContaining({ id: 'existing' }),
        expect.objectContaining({ id: 'g1' }),
      ]),
    }))
  })

  it('forceRefresh calls requestTagSuggestions twice', async () => {
    vi.mocked(requestTagSuggestions).mockResolvedValue({
      kind: 'ok',
      result: { good: [], bad: [], droppedCount: 0, generatedAt: 'x' },
    })
    const w = mount(AISuggestModal, { props: { show: true }, global: { stubs } })
    await new Promise(r => setTimeout(r, 0))
    expect(vi.mocked(requestTagSuggestions)).toHaveBeenCalledTimes(1)

    const refreshBtn = w.findAll('button').find(b => b.text().includes('重新生成'))
    await refreshBtn?.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(vi.mocked(requestTagSuggestions)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(requestTagSuggestions).mock.calls[1][0]).toBe(true)
  })
})
```

- [ ] **Step 2: Run test**

```bash
npm run test -- AISuggestModal
```

Expected: 4 pass.

- [ ] **Step 3: Commit**

```bash
git add lol-record-analysis-tauri/src/components/tags/__tests__/AISuggestModal.spec.ts
git commit -m "test: AISuggestModal 4 个组件测试"
```

---

## Task 8: Integrate into Tags.vue

**Files:**
- Modify: `lol-record-analysis-tauri/src/views/settings/Tags.vue`

- [ ] **Step 1: Read the current Tags.vue to identify the "新增标签" button location**

```bash
grep -n "新增标签\|openCreateModal\|reload\|loadTags\|fetchTags" lol-record-analysis-tauri/src/views/settings/Tags.vue | head -10
```

Note where the existing button lives and what method reloads the table after a save.

- [ ] **Step 2: Add the button + modal**

In the script setup of Tags.vue add:

```ts
import AISuggestModal from '@renderer/components/tags/AISuggestModal.vue'

const aiModalShow = ref(false)

function openAIModal() { aiModalShow.value = true }

// onAdopted: re-load the existing tag list (call whatever method already loads tags)
// Adjust the call below to match the project's existing reload function name
async function onAITagAdopted() {
  // e.g. await loadTags()  OR  reload()  OR  whatever the page already uses
  // Find by reading Tags.vue's existing onMounted or save handler
}
```

In the template, next to the existing "新增标签" button (it should be `<n-button @click="openCreateModal">新增标签</n-button>` per the explore report — line ~5):

```vue
<n-button @click="openCreateModal">新增标签</n-button>
<n-button type="primary" @click="openAIModal">✨ AI 推荐</n-button>
```

At the bottom of the template (alongside the existing edit modal):

```vue
<AISuggestModal v-model:show="aiModalShow" @adopted="onAITagAdopted" />
```

⚠️ **Find the actual reload method** — look at how the existing "新增标签" save flow refreshes the table. Wire `onAITagAdopted` to call the same function. If there isn't one (the table just re-binds reactively from a Pinia store), inspect what state the table reads from and refresh that.

- [ ] **Step 3: Typecheck + lint + tests**

```bash
cd lol-record-analysis-tauri
npm run typecheck
npm run lint
npm run test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add lol-record-analysis-tauri/src/views/settings/Tags.vue
git commit -m "feat: Tags 设置页加 AI 推荐按钮 + 弹窗集成"
```

---

## Task 9: Quality gate + manual smoke + PR

- [ ] **Step 1: Run canonical gate**

```bash
cd lol-record-analysis-tauri
npm run check
npm run test
cd src-tauri && cargo test && cd ..
```

Expected: all green. (No Rust changes in this plan, but cargo test is part of the canonical workflow.)

- [ ] **Step 2: Manual smoke (run dev server)**

```bash
npm run tauri dev
```

Test flow:
- [ ] Open Tags 设置页 → "AI 推荐" button visible next to "新增标签"
- [ ] Click "AI 推荐" → loading spinner → AI returns within 5-15s
- [ ] If recent games < 5 → "近期对局太少" displayed
- [ ] If AI succeeds → see ≤3 good cards (绿色) + ≤3 bad cards (红色)
- [ ] Click "采用" on a card → button → "已采用"，card 灰态；Tags 表格出现新规则
- [ ] Re-open AI modal → 不再发请求，缓存数据展示，已采用的卡片仍灰
- [ ] Click "🔄 重新生成" → 重新发请求 → 新结果（已采用状态会重置，因为 id 是新生成的）
- [ ] 模拟错误：手改 sessionStorage 注入 `not-json` 后重开 modal → 不展示坏数据（缓存解析失败 → 回到从头 fetch → 走错误路径）

- [ ] **Step 3: Push branch and create PR**

```bash
git push -u origin HEAD
```

PR must be opened manually (gh CLI not installed). Open:

```
https://github.com/wnzzer/rank-analysis/pull/new/feat/ai-tag-suggestion
```

PR title: `feat: AI 标签建议 — Tags 设置页一键采用 AI 生成的判定规则`

PR body template:

```markdown
## Summary

Tags 设置页加 `AI 推荐` 按钮：AI 看用户最近 20 场对局，从赢局共同点提取 2-3 个"好标签"、输局共同点提取 2-3 个"坏标签"，直接产 `TagConfig`（含 condition 树）一键采用。

### 流程
- 点击按钮 → 调 `requestTagSuggestions()`
- 取 puuid (`get_my_summoner`) → 取最近 20 场 (`get_match_history_by_puuid`) → 抽特征 → 拆赢/输 → 调 AI proxy
- 严格 schema 校验 AI 输出（不通过的 entry 静默过滤 + 计数）
- 校验通过的渲染成卡片，"采用"调 `save_tag_configs(merged)`
- sessionStorage 缓存结果 + adopted 状态（modal 重开沿用）

### 不在本 PR 范围
- AI 生成的标签是否符合用户偏好（取决于 AI 模型质量，非代码问题）
- 跨会话持久化的"已采用"列表（设计为会话级）

详细设计：`docs/superpowers/specs/2026-05-01-pickban-rules-and-ai-tags-design.md` §特性 2

## Test Plan

- [x] `npm run check` 通过
- [x] `npm run test` 通过（含本 PR 新加的 26 单元测试）
- [x] 手动 smoke：游戏数不足 → 提示
- [x] 手动 smoke：AI 成功 → 卡片正确展示
- [x] 手动 smoke：采用 → 标签库出现新条目
- [x] 手动 smoke：重新生成 → bypass 缓存
- [ ] CI 全绿
```

---

## Self-Review

**1. Spec coverage:**

| Spec section §特性 2 | Task |
|---|---|
| Tags 页加 AI 推荐按钮 | Task 8 |
| 取当前用户最近 20 把（`extractPlayerDeepDive` 风格特征） | Tasks 3, 5 |
| 拆赢/输 → 各产 2-3 标签 | Tasks 3, 4 |
| 标签名 2-5 字儒雅约束 | Task 4 (prompt) + Task 2 (validator drops out-of-range) |
| AI 直接产完整 TagConfig | Task 4 (prompt) + Task 2 (validator) |
| 严格 schema 校验，无效条目过滤 + 计数 | Task 2 |
| sessionStorage 缓存 + 已采用状态保留 | Task 5 (cache helpers) + Task 6 (display) |
| 重新生成按钮 forceRefresh | Tasks 5, 6 |
| 错误路径（AI 失败 / 解析失败 / 局数不足） | Tasks 5, 6 |
| 一键采用调 `save_tag_configs` | Task 6 |
| 全无效空状态 | Task 6 |

All requirements covered.

**2. Placeholder scan:** No "TBD"/"TODO" in plan steps. All Tauri command names and tag schema field names are exact (verified against Rust source). The two yellow-flag verification steps in Task 5 (`get_my_summoner` + `get_match_history_by_puuid` param casing) are explicit verification instructions — not placeholders.

**3. Type consistency:** TagSuggestion = TagConfig + adopted?: boolean (consistent across T1, T2, T5, T6). TagSuggestOutcome discriminated union (`kind: 'ok' | 'insufficient' | 'aiError' | 'parseError'`) used identically in T5 and T6. `MIN_GAMES_REQUIRED = 5` defined in T5 and referenced in T6's "insufficient" copy.

**Issues found / fixed inline:** None — schema is taken from actual Rust source so naming matches.
