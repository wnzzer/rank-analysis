/**
 * matchDetail 模块对外门面。
 *
 * 流程：
 *   game + profileMap
 *     → buildMatchSnapshot
 *     → Stage 1 (attribution.ts) — JSON, sessionStorage 缓存, 失败重试 1 次
 *     → Stage 2 (critique.ts) — 流式 markdown, sessionStorage 缓存
 *     → 失败时 critiqueTemplate 兜底
 *
 * 替代旧的 services/ai/player-insight.ts + prompts/match-detail.ts 入口。
 */

import type { Game } from '@renderer/types/domain/match'
import { buildMatchSnapshot } from '../shared/snapshot'
import type { RecentPlayerProfile } from '../shared/types'
import { runAttributionStage } from './attribution'
import { runCritiqueStage, type CritiqueCallbacks } from './critique'
import { renderFallbackCritique } from './critiqueTemplate'
import type { AttributionResult } from './types'

export type { AttributionResult, MatchAIState } from './types'
export { renderFallbackCritique } from './critiqueTemplate'

export interface AnalyzeOptions {
  /** 词库样本（Stage 2 prompt 注入）。若 tagSuggest vocab 模块尚未实现可传 []。 */
  vocabSamples?: string[]
}

export type AnalyzeOutcome =
  | { ok: true; attribution: AttributionResult; markdown: string }
  | {
      ok: false
      stage: 'attribution' | 'critique'
      error: string
      attribution?: AttributionResult
      fallbackMarkdown?: string
    }

export async function analyzeMatchDetail(
  game: Game,
  profileMap: Map<string, RecentPlayerProfile | null> | null,
  callbacks: CritiqueCallbacks,
  options: AnalyzeOptions = {}
): Promise<AnalyzeOutcome> {
  const snapshot = buildMatchSnapshot(game, profileMap ?? undefined)

  // ─── Stage 1: attribution with retry ───
  let attribution: AttributionResult | null = null
  let stage1LastError = 'unknown'

  // Check sessionStorage cache first; if a previous Stage 1 result is stored
  // we can skip the AI request entirely. (runAttributionStage's underlying
  // requestAIContent normally does this, but checking here lets the facade
  // short-circuit even when requestAIContent is mocked in tests.)
  const stage1Key = `ai_match_detail_stage1_${snapshot.gameId}_${snapshot.modeContext.kind}`
  let cachedStage1: string | null = null
  try {
    cachedStage1 = sessionStorage.getItem(stage1Key)
  } catch {
    cachedStage1 = null
  }
  if (cachedStage1) {
    // Validate cached payload against snapshot; if it's invalid (e.g. snapshot
    // changed), fall through to a fresh call.
    try {
      const parsed = JSON.parse(cachedStage1)
      if (parsed && Array.isArray(parsed.verdicts)) {
        attribution = parsed as AttributionResult
      }
    } catch {
      // ignore, will refetch
    }
  }

  for (let attempt = 0; !attribution && attempt < 2; attempt++) {
    const out = await runAttributionStage(snapshot)
    if (out.ok) {
      attribution = out.value
      break
    }
    stage1LastError = out.error
    // Retry only on parse/validation errors (i.e., we got rawJson back),
    // not on network errors.
    if (!('rawJson' in out) || !out.rawJson) {
      break
    }
    // Invalidate cache before retrying
    const cacheKey = `ai_match_detail_stage1_${snapshot.gameId}_${snapshot.modeContext.kind}`
    try {
      sessionStorage.removeItem(cacheKey)
    } catch {
      // ignore (SSR / no storage)
    }
  }
  if (!attribution) {
    callbacks.onError(stage1LastError)
    return { ok: false, stage: 'attribution', error: stage1LastError }
  }

  // ─── Stage 2: critique (streaming) ───
  // Try cached markdown first
  const stage2Key = `ai_match_detail_stage2_${snapshot.gameId}_${snapshot.modeContext.kind}`
  let cachedMarkdown: string | null = null
  try {
    cachedMarkdown = sessionStorage.getItem(stage2Key)
  } catch {
    cachedMarkdown = null
  }
  if (cachedMarkdown) {
    callbacks.onChunk(cachedMarkdown)
    callbacks.onDone()
    return { ok: true, attribution, markdown: cachedMarkdown }
  }

  const critiqueOut = await runCritiqueStage(snapshot, attribution, callbacks, {
    vocabSamples: options.vocabSamples
  })
  if (!critiqueOut.ok) {
    const fallback = renderFallbackCritique(attribution)
    return {
      ok: false,
      stage: 'critique',
      error: critiqueOut.error,
      attribution,
      fallbackMarkdown: fallback
    }
  }
  try {
    sessionStorage.setItem(stage2Key, critiqueOut.markdown)
  } catch {
    // ignore
  }
  return { ok: true, attribution, markdown: critiqueOut.markdown }
}
