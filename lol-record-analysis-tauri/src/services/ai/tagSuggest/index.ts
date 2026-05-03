/**
 * tagSuggest/index.ts
 *
 * AI 标签建议编排器 — 负责：
 * 1. 获取当前用户 puuid（invoke get_my_summoner）
 * 2. 拉取近期对局（invoke get_match_history_by_puuid）
 * 3. 特征提取 + 胜负拆分
 * 4. 调用 AI（requestAIContent）
 * 5. 校验 AI 返回（parseAndValidate）
 * 6. sessionStorage 缓存（puuid 维度）
 *
 * 对外暴露：
 * - requestTagSuggestions(forceRefresh?)  — AISuggestModal 入口
 * - markAdopted(puuid, suggestionId)      — 标记已采用，跨弹窗保持灰态
 * - getCacheKey(puuid)                    — 测试可见
 * - MIN_GAMES_REQUIRED / MAX_GAMES_FETCHED — 测试可见
 */

import { invoke } from '@tauri-apps/api/core'
import { requestAIContent } from '@renderer/services/ai/stream'
import type { TagSuggestion, TagSuggestResult } from '@renderer/types/tagSuggest'
import type { AIAnalysisResult } from '@renderer/services/ai/types'
import { gameToFeature, splitWinsLosses, type RawGame, type QueueNameMap } from './featureExtract'
import { buildTagSuggestPrompt, SYSTEM_PROMPT } from './prompt'
import { parseAndValidate } from './validator'

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

// 注：缓存按 puuid 分区。切换 LCU 账号后旧缓存仍存在但不会被读到（key 不同），不主动清理。
/**
 * sessionStorage 缓存键（puuid 维度）。
 * @param puuid - 当前用户 puuid
 */
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
    // 忽略（隐私模式 / 配额超限）
  }
}

// ─── public helpers ───────────────────────────────────────────────────────────

/**
 * 将某条建议标记为"已采用"，写回 sessionStorage，使 UI 跨弹窗打开保持灰态。
 *
 * @param puuid        - 当前用户 puuid（用于定位缓存 key）
 * @param suggestionId - 要标记的建议 id
 */
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

// ─── internal helpers ─────────────────────────────────────────────────────────

// Module-level cache: puuid is stable within an LCU session, so we fetch it once.
let cachedPuuid: string | null = null

async function getCurrentUserPuuid(): Promise<string> {
  if (cachedPuuid) return cachedPuuid
  const summoner = await invoke<{ puuid: string }>('get_my_summoner')
  cachedPuuid = summoner.puuid
  return cachedPuuid
}

let cachedQueueNameMap: QueueNameMap | null = null

async function getQueueNameMap(): Promise<QueueNameMap> {
  if (cachedQueueNameMap) return cachedQueueNameMap
  try {
    const opts = await invoke<Array<{ label: string; value: number }>>('get_game_modes')
    const map: Record<number, string> = {}
    for (const o of opts) {
      // 跳过 "全部" 这种汇总项（value=0）
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

// ─── main entry point ─────────────────────────────────────────────────────────

/**
 * AI 标签建议编排器顶层入口 — Tags.vue 中的 AISuggestModal 调用此函数。
 *
 * 流程：
 * 1. 获取当前用户 puuid
 * 2. 若未强制刷新，读 sessionStorage 缓存并直接返回
 * 3. 拉取近 MAX_GAMES_FETCHED 场对局，提取特征
 * 4. 特征不足 MIN_GAMES_REQUIRED 时返回 insufficient
 * 5. 调用 AI，处理返回并写缓存
 *
 * @param forceRefresh - true 时跳过缓存，重新请求 AI（默认 false）
 * @returns TagSuggestOutcome 判别联合
 */
export async function requestTagSuggestions(forceRefresh = false): Promise<TagSuggestOutcome> {
  const puuid = await getCurrentUserPuuid()

  // 命中缓存直接返回
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

  // 拉取对局并提取特征
  const rawGames = await fetchRecentGames(puuid)

  // NEW: prefetch queue name map (cached after first call)
  const queueNameMap = await getQueueNameMap()

  // CHANGED: pass nameMap into gameToFeature
  const features = rawGames
    .map(g => gameToFeature(g, puuid, queueNameMap))
    .filter((f): f is NonNullable<typeof f> => f !== null)

  if (features.length < MIN_GAMES_REQUIRED) {
    return { kind: 'insufficient', gameCount: features.length }
  }

  // 构建 prompt 并调用 AI
  const { wins, losses } = splitWinsLosses(features)
  const userPrompt = buildTagSuggestPrompt(wins, losses)
  // 每次强制刷新使用独立的原始缓存 key，避免与结构化缓存互相污染
  const rawCacheKey = `ai_tag_suggest_raw_${puuid}_${Date.now()}`

  let aiResp: AIAnalysisResult
  try {
    aiResp = await requestAIContent(userPrompt, rawCacheKey, SYSTEM_PROMPT)
  } finally {
    // 不论成功失败都清掉孤儿 raw 缓存（AI throw 时也不留垃圾）
    try {
      sessionStorage.removeItem(rawCacheKey)
    } catch {
      /* ignore */
    }
  }

  if (!aiResp.success) {
    return { kind: 'aiError', error: aiResp.error ?? 'unknown AI error' }
  }

  // Guard against upstream returning HTTP 200 with empty body (e.g. proxy rate-limited
  // or returned non-SSE content) — surface as aiError so the user sees the retry button.
  if (!aiResp.content || aiResp.content.trim().length === 0) {
    return { kind: 'aiError', error: 'AI 返回空响应（可能是代理限流）' }
  }

  // 校验并写缓存
  let parsed
  try {
    parsed = parseAndValidate(aiResp.content)
  } catch (e) {
    return { kind: 'parseError', error: (e as Error).message }
  }

  const toCache: CachedResult = {
    good: parsed.good,
    bad: parsed.bad,
    droppedCount: parsed.droppedCount,
    generatedAt: new Date().toISOString()
  }
  writeCache(puuid, toCache)

  return {
    kind: 'ok',
    result: {
      good: toCache.good,
      bad: toCache.bad,
      droppedCount: toCache.droppedCount,
      generatedAt: toCache.generatedAt
    },
    puuid
  }
}
