/**
 * AI 分析对外 API：
 * - 游戏中整队分析（analyzeGameWithAI/Stream）— 保留旧实现
 * - 单场战绩复盘（analyzeMatchDetailWithAI/Stream）— 转发到 matchDetail 双阶段流水线
 */

import type { Game } from '@renderer/types/domain/match'
import type { SessionData } from '@renderer/types/domain/gaming'
import type { OpggMode } from '@renderer/services/opgg'
import { getConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import type { AIAnalysisResult, MatchDetailAnalysisOptions, StreamCallbacks } from './types'
import { loadChampionNames } from './champion-names'
import { DEFAULT_SYSTEM_PROMPT, requestAIContentStream } from './stream'
import { buildPlayerAnalysisPrompt, buildTeamAnalysisPrompt } from './prompts/team'
import { buildChampSelectPrompt } from './prompts/champSelect'
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
    // 隐私开关：键不存在视为开（默认开），显式 false 时两条链路都不注入备注
    const useNotes = (await getConfigByIpc<boolean>(CONFIG_KEYS.aiUsePlayerNotes)) !== false
    const prompt =
      type === 'team'
        ? buildTeamAnalysisPrompt(gameData, { useNotes })
        : buildPlayerAnalysisPrompt(gameData, { useNotes })
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
 * 选人阶段（ChampSelect）AI 阵容分析：无需等进入对局，选人期即可用。
 * 我方走 puuid 齐全的画像摘要，敌方靠 OP.GG 静态数据（T 级/胜率/克制）撑情报。
 *
 * @param sessionData - 对局会话数据（含 champSelect 结构化视图）
 * @param opggMode - OP.GG 数据模式，决定敌方情报是否含分路克制数据
 * @param callbacks - 流式回调
 */
export async function analyzeChampSelectWithAIStream(
  sessionData: SessionData,
  opggMode: OpggMode,
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    await loadChampionNames()
    const prompt = await buildChampSelectPrompt(sessionData, opggMode)
    // 用 stream.ts 的 DEFAULT_SYSTEM_PROMPT（含"所有结论都必须绑定数据证据"的反幻觉指令），
    // 与选人期 prompt 里的分析纪律硬规则配套；不沿用对局中的 IN_GAME_SYSTEM_PROMPT。
    await requestAIContentStream(prompt, callbacks, DEFAULT_SYSTEM_PROMPT)
  } catch (error: any) {
    console.error('Champ select AI analysis error:', error)
    callbacks.onError(error.message || '网络请求失败')
  }
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
