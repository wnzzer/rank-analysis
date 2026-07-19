/**
 * tagSuggest/index.ts
 *
 * AI 标签建议编排器（双阶段重构版）。
 *
 * 流程：
 *  1. 获取当前用户 puuid（invoke get_my_summoner）
 *  2. 拉取近期对局（invoke get_match_history_by_puuid）
 *  3. 特征提取 + 胜负拆分（featureExtract）
 *  4. runTwoStage:
 *     - Stage 1：风格摘要 + 候选信号（非流式）
 *     - Stage 2：基于候选 + 词库 + 反重复禁用名命名（流式）
 *  5. 拼接 TagCondition（conditionBuilder）
 *  6. 写 sessionStorage 缓存 + 写反重复 LRU
 */

import { invoke } from '@tauri-apps/api/core'
import { runTwoStage } from '@renderer/services/ai/shared/twoStage'
import type { TagSuggestion, TagSuggestResult } from '@renderer/types/tagSuggest'
import { gameToFeature, splitWinsLosses, type RawGame, type QueueNameMap } from './featureExtract'
import { STAGE1_SYSTEM_PROMPT, buildStage1UserPrompt } from './prompts/stage1-profile'
import { buildStage2SystemPrompt, buildStage2UserPrompt } from './prompts/stage2-naming'
import { parseStage1, parseStage2 } from './validator'
import { GOOD_VOCAB } from './vocab/good'
import { BAD_VOCAB } from './vocab/bad'
import { sampleVocab } from './vocab/sampler'
import { readRecentNames, writeRecentNames } from './vocab/deduplicator'
import { buildCondition } from './conditionBuilder'
import type { Candidate, NamingEntry, ProfileSummary } from './types'

// ─── constants ────────────────────────────────────────────────────────────────

export const MIN_GAMES_REQUIRED = 5
export const MAX_GAMES_FETCHED = 20

// ─── outcome discriminated union ──────────────────────────────────────────────

export type TagSuggestOutcome =
  | { kind: 'ok'; result: TagSuggestResult; puuid: string }
  | { kind: 'insufficient'; gameCount: number }
  | { kind: 'aiError'; error: string }
  | { kind: 'parseError'; error: string }

// ─── cache helpers ────────────────────────────────────────────────────────────

export function getCacheKey(puuid: string): string {
  return `ai_tag_suggest_${puuid}`
}

interface CachedResult {
  good: TagSuggestion[]
  bad: TagSuggestion[]
  droppedCount: number
  generatedAt: string
}

function readCache(puuid: string): CachedResult | null {
  try {
    const raw = sessionStorage.getItem(getCacheKey(puuid))
    if (!raw) return null
    return JSON.parse(raw) as CachedResult
  } catch {
    return null
  }
}

function writeCache(puuid: string, data: CachedResult): void {
  try {
    sessionStorage.setItem(getCacheKey(puuid), JSON.stringify(data))
  } catch {
    // ignore (private mode / quota)
  }
}

// ─── public helpers ───────────────────────────────────────────────────────────

export function markAdopted(puuid: string, suggestionId: string): void {
  const cached = readCache(puuid)
  if (!cached) return
  for (const s of [...cached.good, ...cached.bad]) {
    if (s.id === suggestionId) {
      s.adopted = true
    }
  }
  writeCache(puuid, cached)
}

// ─── module state ─────────────────────────────────────────────────────────────

let cachedPuuid: string | null = null
let cachedQueueNameMap: QueueNameMap | null = null

/** Test-only: clears module-level memo caches. */
export function __resetModuleStateForTests(): void {
  cachedPuuid = null
  cachedQueueNameMap = null
}

async function getCurrentUserPuuid(): Promise<string> {
  if (cachedPuuid) return cachedPuuid
  const summoner = await invoke<{ puuid: string }>('get_my_summoner')
  cachedPuuid = summoner.puuid
  return cachedPuuid
}

async function getQueueNameMap(): Promise<QueueNameMap> {
  if (cachedQueueNameMap) return cachedQueueNameMap
  try {
    const opts = await invoke<Array<{ label: string; value: number }>>('get_game_modes')
    const map: Record<number, string> = {}
    for (const o of opts) {
      if (o.value !== 0 && o.label) map[o.value] = o.label
    }
    cachedQueueNameMap = map
    return map
  } catch (e) {
    console.warn('Failed to fetch game modes for tag suggestion', e)
    return {}
  }
}

interface RawMatchHistoryResponse {
  games?: { games?: RawGame[] }
}

async function fetchRecentGames(puuid: string): Promise<RawGame[]> {
  const resp = await invoke<RawMatchHistoryResponse>('get_match_history_by_puuid', {
    puuid,
    begIndex: 0,
    endIndex: MAX_GAMES_FETCHED - 1
  })
  return resp.games?.games ?? []
}

// ─── stitching: NamingEntry + Candidate → TagSuggestion ───────────────────────

function stitchSuggestion(entry: NamingEntry, candidate: Candidate, good: boolean): TagSuggestion {
  return {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: entry.name,
    desc: entry.desc,
    good,
    enabled: true,
    condition: buildCondition(candidate),
    isDefault: false
  }
}

function stitchAll(
  profile: ProfileSummary,
  naming: { good: NamingEntry[]; bad: NamingEntry[] }
): { good: TagSuggestion[]; bad: TagSuggestion[]; droppedCount: number } {
  const goodCandMap = new Map(profile.goodCandidates.map(c => [c.id, c]))
  const badCandMap = new Map(profile.badCandidates.map(c => [c.id, c]))

  const good: TagSuggestion[] = []
  const bad: TagSuggestion[] = []
  let droppedCount = 0

  for (const entry of naming.good) {
    const cand = goodCandMap.get(entry.id)
    if (!cand) {
      droppedCount += 1
      continue
    }
    good.push(stitchSuggestion(entry, cand, true))
  }
  for (const entry of naming.bad) {
    const cand = badCandMap.get(entry.id)
    if (!cand) {
      droppedCount += 1
      continue
    }
    bad.push(stitchSuggestion(entry, cand, false))
  }
  return { good, bad, droppedCount }
}

// ─── main entry point ─────────────────────────────────────────────────────────

/**
 * AI 标签建议编排器顶层入口。
 *
 * @param forceRefresh - true 时跳过缓存，重新调 AI
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
          generatedAt: cached.generatedAt
        },
        puuid
      }
    }
  }

  // Fetch + extract features
  const rawGames = await fetchRecentGames(puuid)
  const queueNameMap = await getQueueNameMap()
  const features = rawGames
    .map(g => gameToFeature(g, puuid, queueNameMap))
    .filter((f): f is NonNullable<typeof f> => f !== null)

  if (features.length < MIN_GAMES_REQUIRED) {
    return { kind: 'insufficient', gameCount: features.length }
  }

  const { wins, losses } = splitWinsLosses(features)

  // Sample vocab + read dedup names
  const goodSample = sampleVocab(GOOD_VOCAB)
  const badSample = sampleVocab(BAD_VOCAB)
  const vocabSample = [...goodSample, ...badSample]
  const recentlyUsed = readRecentNames(puuid)

  // qwen-plus: 实测 JSON 严格度 + 中文锐评感都明显优于 qwen-turbo（默认）。
  // tagSuggest 两阶段都用 qwen-plus，理由同 matchDetail。
  const TAG_MODEL = 'qwen-plus'

  const result = await runTwoStage<
    ProfileSummary,
    { good: NamingEntry[]; bad: NamingEntry[]; skipped: string[] }
  >({
    stage1: {
      systemPrompt: STAGE1_SYSTEM_PROMPT,
      userPrompt: buildStage1UserPrompt(wins, losses),
      parse: parseStage1,
      model: TAG_MODEL,
      // 两阶段都要求严格 JSON 输出，JSON mode 从协议层封死"外裹 markdown 代码块"类解析失败
      jsonMode: true
    },
    stage2: {
      buildSystemPrompt: s1 => buildStage2SystemPrompt(s1, vocabSample, recentlyUsed),
      buildUserPrompt: s1 => buildStage2UserPrompt(s1),
      parse: parseStage2,
      model: TAG_MODEL,
      jsonMode: true
    }
  })

  if (result.kind === 'stage1Error') {
    return { kind: 'aiError', error: result.error }
  }
  if (result.kind === 'stage1ParseError') {
    return { kind: 'parseError', error: result.error }
  }
  if (result.kind === 'stage2Error') {
    return { kind: 'aiError', error: result.error }
  }
  if (result.kind === 'stage2ParseError') {
    return { kind: 'parseError', error: result.error }
  }

  // Stitch
  const stitched = stitchAll(result.stage1, result.stage2)
  const generatedAt = new Date().toISOString()
  const cacheable: CachedResult = {
    good: stitched.good,
    bad: stitched.bad,
    droppedCount: stitched.droppedCount,
    generatedAt
  }
  writeCache(puuid, cacheable)

  // Update dedup LRU
  const allNames = [...stitched.good, ...stitched.bad].map(s => s.name)
  writeRecentNames(puuid, allNames)

  return {
    kind: 'ok',
    result: { ...cacheable },
    puuid
  }
}
