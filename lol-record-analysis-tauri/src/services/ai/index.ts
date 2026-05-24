/**
 * AI 分析对外 API：
 * - 游戏中整队分析（analyzeGameWithAI/Stream）— 保留旧实现
 * - 单场战绩复盘（analyzeMatchDetailWithAI/Stream）— 转发到 matchDetail 双阶段流水线
 */

import type { Game } from '@renderer/types/domain/match'
import type { AIAnalysisResult, MatchDetailAnalysisOptions, StreamCallbacks } from './types'
import { loadChampionNames } from './champion-names'
import { requestAIContentStream } from './stream'
import { buildPlayerAnalysisPrompt, buildTeamAnalysisPrompt } from './prompts/team'
import { analyzeMatchDetail } from './matchDetail'
import type { RecentPlayerProfile } from './shared/types'

export type {
  AIAnalysisResult,
  MatchDetailAnalysisMode,
  MatchDetailAnalysisOptions,
  StreamCallbacks
} from './types'
export { requestAIContentStream } from './stream'
export type { AttributionResult, MatchAIState } from './matchDetail'

const IN_GAME_SYSTEM_PROMPT =
  '你是一个LOL游戏分析师，擅长分析玩家战绩和给出游戏建议。请用简洁的中文回复，不要太长。'

export async function analyzeGameWithAIStream(
  gameData: any,
  type: 'team' | 'player' = 'team',
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    await loadChampionNames()
    const prompt =
      type === 'team' ? buildTeamAnalysisPrompt(gameData) : buildPlayerAnalysisPrompt(gameData)
    await requestAIContentStream(prompt, callbacks, IN_GAME_SYSTEM_PROMPT)
  } catch (error: any) {
    console.error('AI analysis error:', error)
    callbacks.onError(error.message || '网络请求失败')
  }
}

export async function analyzeGameWithAI(
  gameData: any,
  type: 'team' | 'player' = 'team'
): Promise<AIAnalysisResult> {
  return new Promise(resolve => {
    let fullContent = ''
    analyzeGameWithAIStream(gameData, type, {
      onChunk: (chunk: string) => {
        fullContent += chunk
      },
      onDone: () => resolve({ success: true, content: fullContent }),
      onError: (error: string) => resolve({ success: false, error })
    })
  })
}

/**
 * 单场战绩复盘（新双阶段流水线）。
 *
 * @param game        LCU Game 对象
 * @param callbacks   流式回调
 * @param _options    旧 API 兼容字段 mode/participantId 被忽略（新流程统一输出全队复盘）
 * @param extras      profileMap 与词库样本（可选）
 */
export async function analyzeMatchDetailWithAIStream(
  game: Game,
  callbacks: StreamCallbacks,
  _options: MatchDetailAnalysisOptions = {},
  extras?: {
    profileMap?: Map<string, RecentPlayerProfile | null> | null
    vocabSamples?: string[]
  }
): Promise<void> {
  try {
    await loadChampionNames()
    const out = await analyzeMatchDetail(game, extras?.profileMap ?? null, callbacks, {
      vocabSamples: extras?.vocabSamples
    })
    if (!out.ok && out.stage === 'critique' && out.fallbackMarkdown) {
      // The Stage 2 stream already called onError; emit the fallback so UI shows something
      callbacks.onChunk(out.fallbackMarkdown)
      callbacks.onDone()
    }
  } catch (error: any) {
    console.error('Match detail AI stream analysis error:', error)
    callbacks.onError(error.message || '网络请求失败')
  }
}

/**
 * 兼容旧 API：聚合流式输出为一次性结果。
 */
export async function analyzeMatchDetailWithAI(
  game: Game,
  options: MatchDetailAnalysisOptions = {}
): Promise<AIAnalysisResult> {
  return new Promise(resolve => {
    let full = ''
    analyzeMatchDetailWithAIStream(
      game,
      {
        onChunk: c => {
          full += c
        },
        onDone: () => resolve({ success: true, content: full }),
        onError: err => resolve({ success: false, error: err })
      },
      options
    )
  })
}
