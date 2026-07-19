/**
 * matchDetail 模块对外门面。
 *
 * 流程：
 *   game + profileMap
 *     → buildMatchSnapshot
 *     → runTwoStage（shared/twoStage.ts 统一编排）
 *       - Stage 1 (attribution.ts 提供 prompt/缓存键/解析) — JSON mode, 失败重试 1 次
 *       - Stage 2 (critique.ts 提供 prompt 选择) — 流式 markdown
 *     → 失败时 critiqueTemplate 兜底
 *
 * 缓存策略（sessionStorage）：
 * - Stage 1 原始 JSON 由 requestAIContent 按 stage1CacheKey 缓存；门面另做一次
 *   预检（parseAttribution 校验 + 名册回填），命中即传 precomputedStage1 跳过调用。
 * - Stage 2 markdown 按 gameId + 模式 + （单人时）participantId 缓存——
 *   曾因忽略 mode 导致"单人复盘" tab 输出整局内容且缓存互串。
 */

import type { Game } from '@renderer/types/domain/match'
import { buildMatchSnapshot } from '../shared/snapshot'
import { runTwoStage } from '../shared/twoStage'
import type { RecentPlayerProfile } from '../shared/types'
import {
  buildAttributionUserPrompt,
  parseAttribution,
  stage1CacheKey,
  STAGE1_MODEL,
  STAGE1_SYSTEM_PROMPT
} from './attribution'
import {
  buildCritiqueUserPrompt,
  STAGE2_MODEL,
  STAGE2_SYSTEM_PROMPT,
  type CritiqueCallbacks
} from './critique'
import { renderFallbackCritique } from './critiqueTemplate'
import type { AttributionResult } from './types'

export type { AttributionResult, MatchAIState } from './types'
export { renderFallbackCritique } from './critiqueTemplate'

export interface AnalyzeOptions {
  /** 词库样本（Stage 2 prompt 注入）。若 tagSuggest vocab 模块尚未实现可传 []。 */
  vocabSamples?: string[]
  /** 'player' 时 Stage 2 输出单人复盘（需 participantId）；Stage 1 归因两模式共享 */
  mode?: 'overview' | 'player'
  participantId?: number
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

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // ignore (SSR / no storage)
  }
}

export async function analyzeMatchDetail(
  game: Game,
  profileMap: Map<string, RecentPlayerProfile | null> | null,
  callbacks: CritiqueCallbacks,
  options: AnalyzeOptions = {}
): Promise<AnalyzeOutcome> {
  const snapshot = buildMatchSnapshot(game, profileMap ?? undefined)

  // ─── Stage 1 缓存预检 ───
  // requestAIContent 会按同一键缓存原文，这里预检能让门面在 requestAIContent
  // 被 mock（测试）时也短路；必须过 parseAttribution（含名册字段回填），
  // 裸 JSON.parse 会丢 Stage 2 名册依赖的 champion/teamPosition/teamResult。
  const stage1Key = stage1CacheKey(snapshot)
  let cachedAttribution: AttributionResult | null = null
  const cachedStage1Raw = readSession(stage1Key)
  if (cachedStage1Raw) {
    const parsed = parseAttribution(cachedStage1Raw, snapshot)
    if (parsed.ok) cachedAttribution = parsed.value
  }

  // ─── Stage 2 缓存预检（需已有归因才能短路，两级缓存同时命中才免 AI 调用）───
  const isPlayerMode = options.mode === 'player' && options.participantId != null
  const stage2Key = isPlayerMode
    ? `ai_match_detail_stage2_${snapshot.gameId}_${snapshot.modeContext.kind}_p${options.participantId}`
    : `ai_match_detail_stage2_${snapshot.gameId}_${snapshot.modeContext.kind}`
  const cachedMarkdown = readSession(stage2Key)
  if (cachedAttribution && cachedMarkdown) {
    callbacks.onChunk(cachedMarkdown)
    callbacks.onDone()
    return { ok: true, attribution: cachedAttribution, markdown: cachedMarkdown }
  }

  const result = await runTwoStage<AttributionResult, string>({
    precomputedStage1: cachedAttribution ?? undefined,
    stage1: {
      systemPrompt: STAGE1_SYSTEM_PROMPT,
      userPrompt: buildAttributionUserPrompt(snapshot),
      parse: raw => parseAttribution(raw, snapshot),
      cacheKey: stage1Key,
      retry: 1,
      model: STAGE1_MODEL,
      jsonMode: true
    },
    stage2: {
      buildSystemPrompt: () => STAGE2_SYSTEM_PROMPT,
      buildUserPrompt: attribution => buildCritiqueUserPrompt(attribution, snapshot, options),
      // Stage 2 是自由 markdown，无解析需求；流式 chunk 直接转发给调用方
      parse: raw => ({ ok: true, value: raw }),
      streamCallback: callbacks.onChunk,
      model: STAGE2_MODEL
    }
  })

  switch (result.kind) {
    case 'stage1Error':
    case 'stage1ParseError':
      callbacks.onError(result.error)
      return { ok: false, stage: 'attribution', error: result.error }
    case 'stage2Error':
    case 'stage2ParseError':
      // 先 onError 再返回 fallbackMarkdown；调用方（services/ai/index.ts）会兜底渲染
      callbacks.onError(result.error)
      return {
        ok: false,
        stage: 'critique',
        error: result.error,
        attribution: result.stage1,
        fallbackMarkdown: renderFallbackCritique(result.stage1)
      }
    case 'ok': {
      callbacks.onDone()
      writeSession(stage2Key, result.stage2)
      return { ok: true, attribution: result.stage1, markdown: result.stage2 }
    }
  }
}
