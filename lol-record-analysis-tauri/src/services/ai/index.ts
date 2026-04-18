/**
 * AI 分析对外 API：
 * - 游戏中整队分析（analyzeGameWithAI/Stream）
 * - 单场战绩复盘（analyzeMatchDetailWithAI/Stream）
 */

import type { Game } from '@renderer/types/domain/match'
import type { AIAnalysisResult, MatchDetailAnalysisOptions, StreamCallbacks } from './types'
import { loadChampionNames } from './champion-names'
import { requestAIContent, requestAIContentStream } from './stream'
import { buildPlayerAnalysisPrompt, buildTeamAnalysisPrompt } from './prompts/team'
import {
  buildMatchOverviewAnalysisPrompt,
  buildMatchPlayerAnalysisPrompt
} from './prompts/match-detail'

export type {
  AIAnalysisResult,
  MatchDetailAnalysisMode,
  MatchDetailAnalysisOptions,
  StreamCallbacks
} from './types'
export { requestAIContentStream } from './stream'

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

export async function analyzeMatchDetailWithAI(
  game: Game,
  options: MatchDetailAnalysisOptions = {}
): Promise<AIAnalysisResult> {
  try {
    await loadChampionNames()
    const mode = options.mode ?? 'overview'
    const prompt =
      mode === 'player'
        ? buildMatchPlayerAnalysisPrompt(game, options.participantId)
        : buildMatchOverviewAnalysisPrompt(game)

    const cacheKey =
      mode === 'player'
        ? `match_detail_player_${game.gameId}_${options.participantId ?? 'unknown'}`
        : `match_detail_overview_${game.gameId}`

    return await requestAIContent(prompt, cacheKey)
  } catch (error: any) {
    console.error('Match detail AI analysis error:', error)
    return { success: false, error: error.message || '网络请求失败' }
  }
}

export async function analyzeMatchDetailWithAIStream(
  game: Game,
  callbacks: StreamCallbacks,
  options: MatchDetailAnalysisOptions = {}
): Promise<void> {
  try {
    await loadChampionNames()
    const mode = options.mode ?? 'overview'
    const prompt =
      mode === 'player'
        ? buildMatchPlayerAnalysisPrompt(game, options.participantId)
        : buildMatchOverviewAnalysisPrompt(game)
    await requestAIContentStream(prompt, callbacks)
  } catch (error: any) {
    console.error('Match detail AI stream analysis error:', error)
    callbacks.onError(error.message || '网络请求失败')
  }
}
