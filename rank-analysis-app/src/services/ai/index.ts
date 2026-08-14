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
import { buildChampSelectPrompt, type ChampSelectPromptExtras } from './prompts/champSelect'
import { buildLiveGamePrompt, type LiveGamePromptExtras } from './prompts/liveGame'
import type { LiveGameSnapshot } from '@renderer/services/liveGame'
import { analyzeMatchDetail } from './matchDetail'
import type { AIAnalysisReport } from './matchDetail'
import type { RecentPlayerProfile } from './shared/types'

export type {
  AIAnalysisResult,
  MatchDetailAnalysisMode,
  MatchDetailAnalysisOptions,
  StreamCallbacks
} from './types'
export { requestAIContentStream } from './stream'
export type { AttributionResult, MatchAIState } from './matchDetail'
export type { AIAnalysisReport } from './matchDetail'

export async function analyzeGameWithAIStream(
  gameData: any,
  type: 'team' | 'player' = 'team',
  callbacks: StreamCallbacks,
  opts: { opggMode?: OpggMode } = {}
): Promise<void> {
  try {
    await loadChampionNames()
    // 隐私开关：键不存在视为开（默认开），显式 false 时两条链路都不注入备注
    const useNotes = (await getConfigByIpc<boolean>(CONFIG_KEYS.aiUsePlayerNotes)) !== false
    const prompt =
      type === 'team'
        ? await buildTeamAnalysisPrompt(gameData, { useNotes, opggMode: opts.opggMode })
        : await buildPlayerAnalysisPrompt(gameData, { useNotes })
    // DEFAULT_SYSTEM_PROMPT 带"所有结论都必须绑定数据证据"反幻觉指令，
    // 与 prompt 内纪律区配套（旧的弱版 IN_GAME_SYSTEM_PROMPT 已淘汰）。
    await requestAIContentStream(prompt, callbacks, DEFAULT_SYSTEM_PROMPT)
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
 * @param extras - 确定性事实注入（D-P2 选人期 tab：规则引擎决策 + 阵容强度分）
 */
export async function analyzeChampSelectWithAIStream(
  sessionData: SessionData,
  opggMode: OpggMode,
  callbacks: StreamCallbacks,
  extras?: ChampSelectPromptExtras
): Promise<void> {
  try {
    await loadChampionNames()
    const prompt = await buildChampSelectPrompt(sessionData, opggMode, extras)
    // 用 stream.ts 的 DEFAULT_SYSTEM_PROMPT（含"所有结论都必须绑定数据证据"的反幻觉指令），
    // 与选人期 prompt 里的分析纪律硬规则配套；不沿用对局中的 IN_GAME_SYSTEM_PROMPT。
    await requestAIContentStream(prompt, callbacks, DEFAULT_SYSTEM_PROMPT)
  } catch (error: any) {
    console.error('Champ select AI analysis error:', error)
    callbacks.onError(error.message || '网络请求失败')
  }
}

/**
 * 对局中实时诊断（D-P2 对局中 tab）。
 *
 * @param snapshot  - 实时快照（liveclientdata 结构化子集）
 * @param callbacks - 流式回调
 * @param extras    - 我方召唤师名 + PUGG 出装推荐（确定性事实）
 */
export async function analyzeLiveGameWithAIStream(
  snapshot: LiveGameSnapshot,
  callbacks: StreamCallbacks,
  extras: LiveGamePromptExtras
): Promise<void> {
  try {
    const prompt = buildLiveGamePrompt(snapshot, extras)
    await requestAIContentStream(prompt, callbacks, DEFAULT_SYSTEM_PROMPT)
  } catch (error: any) {
    console.error('Live game AI analysis error:', error)
    callbacks.onError(error.message || '网络请求失败')
  }
}

/**
 * 单场战绩复盘（新双阶段流水线）。
 *
 * @param game        LCU Game 对象
 * @param callbacks   流式回调：成功时走 onStructured（结构化报告），失败降级时走
 *                    onChunk（兜底 markdown）+ onDone
 * @param options     mode: 'overview' 整局锐评 / 'player' 单人复盘（需 participantId）。
 *                    Stage 1 归因两模式共享缓存，Stage 2 按模式与目标玩家分别缓存。
 * @param extras      profileMap 与词库样本（可选）
 */
export async function analyzeMatchDetailWithAIStream(
  game: Game,
  callbacks: StreamCallbacks,
  options: MatchDetailAnalysisOptions = {},
  extras?: {
    profileMap?: Map<string, RecentPlayerProfile | null> | null
    vocabSamples?: string[]
  }
): Promise<void> {
  try {
    await loadChampionNames()
    const out = await analyzeMatchDetail(game, extras?.profileMap ?? null, callbacks, {
      vocabSamples: extras?.vocabSamples,
      mode: options.mode,
      participantId: options.participantId
    })
    if (out.ok) {
      callbacks.onStructured?.(out.report)
      callbacks.onDone()
    } else if (out.stage === 'critique' && out.fallbackMarkdown) {
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
 * D-P1 后 Stage 2 走结构化；兼容层把成功报告序列化为 content 字段返回。
 */
export async function analyzeMatchDetailWithAI(
  game: Game,
  options: MatchDetailAnalysisOptions = {}
): Promise<AIAnalysisResult> {
  return new Promise(resolve => {
    let full = ''
    let report: AIAnalysisReport | null = null
    analyzeMatchDetailWithAIStream(
      game,
      {
        onChunk: c => {
          full += c
        },
        onStructured: r => {
          report = r
        },
        onDone: () =>
          resolve(
            report
              ? { success: true, content: JSON.stringify(report) }
              : { success: true, content: full }
          ),
        onError: err => resolve({ success: false, error: err })
      },
      options
    )
  })
}
