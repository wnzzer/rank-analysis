/**
 * Stage 2（锐评/单人复盘）的 prompt 选择与配置。
 *
 * 编排（流式调用、缓存、降级兜底）统一由 index.ts + shared/twoStage.ts 承担，
 * 本文件只提供构建块：
 * - buildCritiqueUserPrompt: 按 mode 选整局锐评 / 单人复盘 prompt
 * - STAGE2_SYSTEM_PROMPT / STAGE2_MODEL
 */

import type { MatchSnapshot } from '../shared/snapshot'
import { buildStage2Prompt } from './prompts/stage2-critique'
import { buildStage2PlayerPrompt } from './prompts/stage2-player'
import type { AttributionResult } from './types'

export interface CritiqueCallbacks {
  onChunk: (chunk: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export interface CritiqueOptions {
  vocabSamples?: string[]
  /** 'player' 时聚焦单个玩家（需 participantId），默认整局锐评 */
  mode?: 'overview' | 'player'
  participantId?: number
}

export const STAGE2_SYSTEM_PROMPT =
  '你是 LOL 锐评写手，按用户给定的 markdown 模板输出，不要返回 JSON / 解释 / 前后缀。'

/**
 * Stage 2 内置默认模型（远程配置 `matchCritique` 场景拉不到时用，见 ../modelConfig.ts）。
 * deepseek-v4.1-flash-1017：tests/ai-features.eval.ts 实测单人复盘材料外数字 0.21/篇
 * （qwen-flash 0.67、qwen3.8-flash 0.75），过程编造近乎为 0，出字速度最快。
 */
export const STAGE2_MODEL = 'deepseek-v4.1-flash-1017'

/** Stage 2 user prompt：'player' + participantId → 单人复盘，其余 → 整局锐评 */
export function buildCritiqueUserPrompt(
  attribution: AttributionResult,
  snapshot: MatchSnapshot,
  options: CritiqueOptions = {}
): string {
  return options.mode === 'player' && options.participantId != null
    ? buildStage2PlayerPrompt(
        attribution,
        snapshot,
        options.participantId,
        options.vocabSamples ?? []
      )
    : buildStage2Prompt(attribution, snapshot, options.vocabSamples ?? [])
}
