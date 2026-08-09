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
 * Stage 2 模型：qwen-flash。
 * 真实基准（见 tests/bench-ai-models.mjs）：flash 锐评总耗时 ~6s（plus ~17s），
 * 锐评感追平 qwen-plus（"拆迁现场""演《孤勇者》"），且只引用归因 JSON 里的数字，
 * 不像 qwen-plus 会编造新数字（违反 grounding）。速度 2.8× 且更稳，故切换。
 */
export const STAGE2_MODEL = 'qwen-flash'

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
