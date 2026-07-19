/**
 * Stage 1（归因）的 prompt / 缓存键 / 解析配置。
 *
 * 编排（调用 AI、缓存、重试）统一由 shared/twoStage.ts 的 runTwoStage 承担，
 * 本文件只提供喂给它的构建块：
 * - buildAttributionUserPrompt: snapshot + 模式 addon → Stage 1 user prompt
 * - stage1CacheKey: sessionStorage 缓存键（gameId + 模式 kind + 模型，模型变更自动失效）
 * - parseAttribution: 原始输出 → validator 三层校验（含名册字段回填）
 */

import type { MatchSnapshot } from '../shared/snapshot'
import type { ParseOutcome } from '../shared/twoStage'
import { DEFAULT_SYSTEM_PROMPT } from '../stream'
import { getModePromptAddon } from './dispatcher'
import { buildStage1Prompt } from './prompts/stage1-attribution'
import { validateAttribution } from './validator'
import type { AttributionResult } from './types'

export const STAGE1_SYSTEM_PROMPT =
  '你是 LOL 单场归因分析师。严格按照用户给定的 JSON schema 返回结果，' +
  '不要返回 markdown / 解释 / 前后缀，只返回纯 JSON 对象。'

/**
 * Stage 1 模型：qwen-flash。
 * 真实基准（33k 字符 Stage 1 prompt，见 tests/bench-ai-models.mjs）：
 * - qwen-flash 总耗时 ~12s、2/2 校验通过、归因精准（mitigatingFactors 正确绑定 recentProfile）；
 * - qwen-plus 总耗时 ~40s 且约半数概率吐非法 JSON（超长破坏结构），是"加载不出来"的主因。
 * flash 在速度（3.4×）与有效率上全面胜出，故切换。
 */
export const STAGE1_MODEL = 'qwen-flash'

/** Stage 1 user prompt：公共骨架 + 按 modeContext 路由的模式追加规则 */
export function buildAttributionUserPrompt(snapshot: MatchSnapshot): string {
  const addon = getModePromptAddon(snapshot.modeContext)
  return buildStage1Prompt(snapshot, addon.rules)
}

/**
 * Stage 1 缓存键。requestAIContent 用它缓存原始输出，外层门面也用同一键做
 * 短路预检——必须单一键，曾因门面与请求层各持一键导致重试失效错键（重试空转）。
 */
export function stage1CacheKey(snapshot: MatchSnapshot): string {
  const addon = getModePromptAddon(snapshot.modeContext)
  return `ai_match_detail_stage1_${snapshot.gameId}_${addon.kind}_${STAGE1_MODEL}`
}

/**
 * 解析并校验 Stage 1 原始输出（ParseOutcome 形状，直接可作 runTwoStage 的 parse）。
 * validator 会把 champion/teamPosition/teamResult 回填进 verdicts——Stage 2 名册依赖
 * 这些字段，所以任何消费缓存原文的路径都必须走这里，不能裸 JSON.parse。
 */
export function parseAttribution(
  raw: string,
  snapshot: MatchSnapshot
): ParseOutcome<AttributionResult> {
  return validateAttribution(raw, snapshot)
}

// Re-export the default system prompt name in case callers need to override
export { DEFAULT_SYSTEM_PROMPT }
