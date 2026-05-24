/**
 * Stage 2 orchestrator —— 锐评流式调用。
 *
 * 流程：
 *   (snapshot, attribution)
 *     → buildStage2Prompt
 *     → requestAIContentStream（流式）
 *     → 累积 markdown，调用方通过 callbacks 实时拿到 chunk
 *     → 失败时用 critiqueTemplate.renderFallbackCritique 兜底
 */

import type { MatchSnapshot } from '../shared/snapshot'
import { requestAIContentStream } from '../stream'
import { buildStage2Prompt } from './prompts/stage2-critique'
import { renderFallbackCritique } from './critiqueTemplate'
import type { AttributionResult } from './types'

export interface CritiqueCallbacks {
  onChunk: (chunk: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export interface CritiqueOptions {
  vocabSamples?: string[]
}

export type CritiqueOutcome =
  | { ok: true; markdown: string }
  | { ok: false; error: string; fallbackMarkdown: string }

const STAGE2_SYSTEM_PROMPT =
  '你是 LOL 锐评写手，按用户给定的 markdown 模板输出，不要返回 JSON / 解释 / 前后缀。'

/**
 * Stage 2 模型：qwen-plus 实测中文锐评感强（"给对面发年终奖" /
 * "伤害低过我的咖啡因摄入量"）显著优于 qwen-turbo 的套话与 qwen-max 的正式语气。
 */
const STAGE2_MODEL = 'qwen-plus'

export async function runCritiqueStage(
  snapshot: MatchSnapshot,
  attribution: AttributionResult,
  callbacks: CritiqueCallbacks,
  options: CritiqueOptions = {}
): Promise<CritiqueOutcome> {
  const userPrompt = buildStage2Prompt(attribution, snapshot, options.vocabSamples ?? [])

  let accumulated = ''
  let errored = false
  let errorMessage = ''

  await new Promise<void>(resolve => {
    requestAIContentStream(
      userPrompt,
      {
        onChunk: chunk => {
          accumulated += chunk
          callbacks.onChunk(chunk)
        },
        onDone: () => {
          callbacks.onDone()
          resolve()
        },
        onError: err => {
          errored = true
          errorMessage = err
          callbacks.onError(err)
          resolve()
        }
      },
      STAGE2_SYSTEM_PROMPT,
      STAGE2_MODEL
    )
  })

  if (errored) {
    return {
      ok: false,
      error: errorMessage,
      fallbackMarkdown: renderFallbackCritique(attribution)
    }
  }

  return { ok: true, markdown: accumulated }
}
