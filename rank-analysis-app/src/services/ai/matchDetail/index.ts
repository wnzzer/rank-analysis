/**
 * matchDetail 模块对外门面。
 *
 * 流程：
 *   game + profileMap
 *     → buildMatchSnapshot
 *     → runTwoStage（shared/twoStage.ts 统一编排）
 *       - Stage 1 (attribution.ts 提供 prompt/缓存键/解析) — JSON mode, 失败重试 1 次
 *       - Stage 2 (critique.ts 提供 prompt 选择) — JSON mode, 输出 CritiqueDraft
 *     → critiqueReport.ts 合成 AIAnalysisReport（名册分组来自 Stage 1 确定性映射）
 *     → 失败时 critiqueTemplate 兜底 markdown
 *
 * 缓存策略（D-P1 磁盘优先，sessionStorage 兜底）：
 * - 键：AI 复用键 = `{patch}:{gameId}:{modeKind}:{p{pid}?}` 由 Rust 端按 patch 分片
 *   校验（异 patch 视为脏缓存作废）；Stage 1 额外带模型后缀（单一键原则）。
 * - Stage 1 原始 JSON 命中后仍需过 parseAttribution 校验 + 名册回填。
 * - Stage 2 草案按 gameId + 模式 + （单人时）participantId 缓存——
 *   曾因忽略 mode 导致"单人复盘" tab 输出整局内容且缓存互串。
 */

import type { Game } from '@renderer/types/domain/match'
import { buildMatchSnapshot } from '../shared/snapshot'
import { runTwoStage } from '../shared/twoStage'
import { aiCacheGet, aiCachePut, dataPatch } from '../shared/cache'
import { recordAiUsage } from '../shared/usage'
import type { RecentPlayerProfile } from '../shared/types'
import type { AiUsage } from '../types'
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
import {
  assembleAnalysisReport,
  validateCritiqueReport,
  type CritiqueDraft
} from './critiqueReport'
import { renderFallbackCritique } from './critiqueTemplate'
import type { AttributionResult, AIAnalysisReport } from './types'
import type { PlayerScore } from '@renderer/services/playerScore'

export type { AttributionResult, MatchAIState } from './types'
export type { AIAnalysisReport } from './types'
export { renderFallbackCritique } from './critiqueTemplate'

export interface AnalyzeOptions {
  /** 词库样本（Stage 2 prompt 注入）。若 tagSuggest vocab 模块尚未实现可传 []。 */
  vocabSamples?: string[]
  /** 'player' 时 Stage 2 输出单人复盘（需 participantId）；Stage 1 归因两模式共享 */
  mode?: 'overview' | 'player'
  participantId?: number
  /** 确定性评分（Rust 侧 17 分制事实，best-effort；缺失时 prompt 不引用评分）。
   *  评分是同一对局数据的纯函数，命中 Stage 1 缓存时无需失效。 */
  playerScores?: PlayerScore[] | null
}

export type AnalyzeOutcome =
  | { ok: true; attribution: AttributionResult; report: AIAnalysisReport }
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
  // patch 分片：当前对局版本（如 "25.6"），缺省给 unknown（不参与分片校验）
  const patch = dataPatch(game.gameVersion)

  // ─── Stage 1 缓存预检 ───
  // 必须过 parseAttribution（含名册字段回填），裸 JSON.parse 会丢 Stage 2
  // 名册依赖的 champion/teamPosition/teamResult。
  const stage1Key = stage1CacheKey(snapshot)
  let cachedAttribution: AttributionResult | null = null
  const cachedStage1Raw = await aiCacheGet(stage1Key, patch)
  if (cachedStage1Raw) {
    const parsed = parseAttribution(cachedStage1Raw, snapshot)
    if (parsed.ok) cachedAttribution = parsed.value
  }

  // ─── Stage 2 缓存预检（需已有归因才能短路，两级缓存同时命中才免 AI 调用）───
  const isPlayerMode = options.mode === 'player' && options.participantId != null
  const stage2Key = isPlayerMode
    ? `ai_match_detail_stage2_${snapshot.gameId}_${snapshot.modeContext.kind}_p${options.participantId}`
    : `ai_match_detail_stage2_${snapshot.gameId}_${snapshot.modeContext.kind}`

  // ─── D-P1 token 用量统计：跨 Stage 1/2 累计，终态时落一条台账 ───
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const usageSink: (u: AiUsage) => void = u => {
    usage.promptTokens += u.promptTokens
    usage.completionTokens += u.completionTokens
    usage.totalTokens += u.totalTokens
  }
  const flushUsage = () => {
    // 全缓存命中时 total 为 0，recordAiUsage 内部会跳过，无需特判
    recordAiUsage({
      time: Date.now(),
      gameId: snapshot.gameId,
      mode: isPlayerMode ? 'player' : 'overview',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    })
  }

  const cachedDraftRaw = await aiCacheGet(stage2Key, patch)
  if (cachedAttribution && cachedDraftRaw) {
    const draft = validateCritiqueReport(cachedDraftRaw)
    if (draft.ok) {
      const report = assembleAnalysisReport(cachedAttribution, draft.value)
      callbacks.onDone()
      return { ok: true, attribution: cachedAttribution, report }
    }
  }

  const result = await runTwoStage<AttributionResult, CritiqueDraft>({
    precomputedStage1: cachedAttribution ?? undefined,
    stage1: {
      systemPrompt: STAGE1_SYSTEM_PROMPT,
      userPrompt: await buildAttributionUserPrompt(snapshot, options.playerScores),
      parse: raw => parseAttribution(raw, snapshot),
      cacheKey: stage1Key,
      retry: 1,
      model: STAGE1_MODEL,
      jsonMode: true,
      onUsage: usageSink
    },
    stage2: {
      buildSystemPrompt: () => STAGE2_SYSTEM_PROMPT,
      buildUserPrompt: attribution => buildCritiqueUserPrompt(attribution, snapshot, options),
      // Stage 2 只解析草案（CritiqueDraft）；名册合成发生在 ok 分支，
      // 那时 result.stage1 已就绪，这里不能引用外层变量（时序上不可靠）。
      parse: raw => validateCritiqueReport(raw),
      streamCallback: callbacks.onChunk,
      model: STAGE2_MODEL,
      jsonMode: true,
      onUsage: usageSink
    }
  })

  // 终态统一记账（含失败的半程消耗；纯缓存命中 total=0 自动跳过）
  flushUsage()

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
      const report = assembleAnalysisReport(result.stage1, result.stage2)
      // 双键都落盘：Stage 1 归因（下次预检直接短路）+ Stage 2 草案
      await aiCachePut(stage1Key, patch, JSON.stringify(result.stage1))
      await aiCachePut(stage2Key, patch, JSON.stringify(result.stage2))
      return { ok: true, attribution: result.stage1, report }
    }
  }
}
