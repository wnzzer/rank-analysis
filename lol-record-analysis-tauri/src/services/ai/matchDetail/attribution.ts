/**
 * Stage 1 orchestrator —— 归因调用。
 *
 * 流程：
 *   snapshot
 *     → dispatcher.getModePromptAddon
 *     → buildStage1Prompt(snapshot, addon.rules)
 *     → requestAIContent (sessionStorage 缓存 by cacheKey)
 *     → validateAttribution(rawJson, snapshot)
 *
 * 重试在 index.ts (通过 twoStage 或显式循环) 中处理；本函数只跑一次。
 */

import type { MatchSnapshot } from '../shared/snapshot'
import { requestAIContent, DEFAULT_SYSTEM_PROMPT } from '../stream'
import { getModePromptAddon } from './dispatcher'
import { buildStage1Prompt } from './prompts/stage1-attribution'
import { validateAttribution } from './validator'
import type { AttributionResult } from './types'

export type AttributionOutcome =
  | { ok: true; value: AttributionResult; rawJson: string }
  | { ok: false; error: string; rawJson?: string }

const STAGE1_SYSTEM_PROMPT =
  '你是 LOL 单场归因分析师。严格按照用户给定的 JSON schema 返回结果，' +
  '不要返回 markdown / 解释 / 前后缀，只返回纯 JSON 对象。'

export async function runAttributionStage(
  snapshot: MatchSnapshot
): Promise<AttributionOutcome> {
  const addon = getModePromptAddon(snapshot.modeContext)
  const userPrompt = buildStage1Prompt(snapshot, addon.rules)
  const cacheKey = `ai_match_detail_stage1_${snapshot.gameId}_${addon.kind}`

  const resp = await requestAIContent(userPrompt, cacheKey, STAGE1_SYSTEM_PROMPT)
  if (!resp.success) {
    return { ok: false, error: resp.error ?? 'AI request failed' }
  }

  const rawJson = resp.content ?? ''
  const validated = validateAttribution(rawJson, snapshot)
  if (!validated.ok) {
    return { ok: false, error: validated.error, rawJson }
  }
  return { ok: true, value: validated.value, rawJson }
}

// Re-export the default system prompt name in case callers need to override
export { STAGE1_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT }
