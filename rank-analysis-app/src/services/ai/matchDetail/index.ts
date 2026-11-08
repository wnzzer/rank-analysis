/**
 * matchDetail 模块对外门面（单次模型调用）。
 *
 * 流程：
 *   game + profileMap
 *     → buildMatchSnapshot（含时间线卡片、死亡归责与时间线指标）
 *     → buildScoredAttribution（TS：国服基准评分 → 标签 → 必出名单 → 归因骨架，零模型调用）
 *     → Stage 2 流式 markdown（critique.ts 按模式选 prompt；锐评措辞与胜负因果润色由模型写）
 *     → 失败时 critiqueTemplate 兜底
 *
 * 缓存：只缓存 Stage 2 markdown（stage2Cache：localStorage 有界 LRU，跨详情窗与重启有效，
 * 避免重开同一局又计费；key = gameId + 模式 kind + 单人 participantId + 时间线 + 模型名，
 * 远端/设置里换模型后不会把旧模型的文本当新结果）。
 * 模型：按 matchCritique 场景远程可配（modelConfig.resolveModel），STAGE2_MODEL 只是兜底。
 * 归因骨架是纯函数，每次重算，同输入同输出。
 */

import type { Game } from '@renderer/types/domain/match'
import { resolveModel } from '../modelConfig'
import { buildMatchSnapshot } from '../shared/snapshot'
import type { RecentPlayerProfile } from '../shared/types'
import { visibleCards, type SlimTimeline, type TimelineCard } from '../shared/timeline'
import { requestAIContentStream } from '../stream'
import {
  buildCritiqueUserPrompt,
  STAGE2_MODEL,
  STAGE2_SYSTEM_PROMPT,
  type CritiqueCallbacks
} from './critique'
import { renderFallbackCritique } from './critiqueTemplate'
import { buildEntityFacts, type MisattributionMaterial } from './misattribution'
import { extractNumbers } from './postprocess'
import { buildScoredAttribution } from './scoredAttribution'
import { readStage2Cache, writeStage2Cache } from './stage2Cache'
import type { AttributionResult } from './types'

export type { AttributionResult, MatchAIState } from './types'
export { renderFallbackCritique } from './critiqueTemplate'

export interface AnalyzeOptions {
  /** 词库样本（Stage 2 prompt 注入）。若 tagSuggest vocab 模块尚未实现可传 []。 */
  vocabSamples?: string[]
  /** 'player' 时 Stage 2 输出单人复盘（需 participantId）；归因骨架两模式共享 */
  mode?: 'overview' | 'player'
  participantId?: number
  /**
   * 归因骨架就绪时回调（缓存命中/实时均触发，先于 Stage 2 流式输出）。
   * UI 渲染层用其中的名册（name+label）做人物章节的确定性重排。
   */
  onAttribution?: (attribution: AttributionResult) => void
  /**
   * Stage 2 prompt 定稿时回调材料数字白名单（整局/单人两模式，缓存命中/实时均触发）。
   * UI 渲染层用它剔除模型编造数字的句子。
   */
  onStage2Material?: (allowedNumbers: Set<number>) => void
  /**
   * 玩家身份与指标（两种模式都触发，先于 Stage 2 输出）。
   * UI 渲染层用它剔除张冠李戴的句子（见 misattribution.ts）。
   */
  onEntityFacts?: (material: MisattributionMaterial) => void
  /** 已拉取并对齐的时间线（null/undefined = 无时间线） */
  timeline?: SlimTimeline | null
  /**
   * 快照生成后回调模型可见的卡片（见 visibleCards；无时间线时为 null）。
   * UI 用于引用校验与角标——不在其中的编号视为编造。
   */
  onTimelineCards?: (cards: TimelineCard[] | null) => void
}

export type AnalyzeOutcome =
  | { ok: true; attribution: AttributionResult; markdown: string }
  | {
      ok: false
      stage: 'attribution' | 'critique'
      error: string
      attribution?: AttributionResult
      fallbackMarkdown?: string
    }

/** Stage 2 流式调用：chunk 即时转发，结束后给出全文或错误 */
function streamMarkdown(
  prompt: string,
  model: string,
  onChunk: (chunk: string) => void
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return new Promise(resolve => {
    let text = ''
    requestAIContentStream(
      prompt,
      {
        onChunk: chunk => {
          text += chunk
          onChunk(chunk)
        },
        onDone: () => resolve({ ok: true, text }),
        onError: error => resolve({ ok: false, error })
      },
      STAGE2_SYSTEM_PROMPT,
      model
    )
  })
}

/** 低于该时长(秒)视为重开局,不做 AI 复盘(数据无分析价值,模型只会硬编) */
export const REMAKE_MAX_SECONDS = 300

export async function analyzeMatchDetail(
  game: Game,
  profileMap: Map<string, RecentPlayerProfile | null> | null,
  callbacks: CritiqueCallbacks,
  options: AnalyzeOptions = {}
): Promise<AnalyzeOutcome> {
  // 重开局短路:1 分钟的对局也能让模型一本正经写出"高效刷野无贡献型"(真机复现),
  // 不如不写。固定文案直接走 onChunk/onDone,UI 渲染路径不变。
  if (game.gameDuration < REMAKE_MAX_SECONDS) {
    const markdown =
      '## 一句话定论\n本局为重开局(时长不足 5 分钟),没有可分析的对局数据,AI 复盘跳过。'
    callbacks.onChunk(markdown)
    callbacks.onDone()
    return {
      ok: true,
      attribution: { winReason: '重开局,无胜负归因', verdicts: [] },
      markdown
    }
  }

  const snapshot = buildMatchSnapshot(game, profileMap ?? undefined, options.timeline)
  const tlCards = snapshot.timeline?.cards
  if (snapshot.players.length === 0) {
    options.onTimelineCards?.(null)
    const error = 'no players in snapshot'
    callbacks.onError(error)
    return { ok: false, stage: 'attribution', error }
  }

  // 标签/名单/证据由 TS 评分确定（同局两跑一致率 = 1），模型只写措辞
  const attribution = buildScoredAttribution(snapshot)
  // 可见卡片依赖 winReason 里引用的编号，故在归因之后回调
  options.onTimelineCards?.(
    tlCards
      ? visibleCards(
          tlCards,
          options.mode ?? 'overview',
          options.participantId,
          attribution.winReason
        )
      : null
  )
  options.onAttribution?.(attribution)

  const isPlayerMode = options.mode === 'player' && options.participantId != null
  options.onEntityFacts?.({
    players: buildEntityFacts(snapshot),
    subjectId: isPlayerMode ? options.participantId : undefined
  })
  const prompt = buildCritiqueUserPrompt(attribution, snapshot, options)
  // prompt 里的数字就是模型可引用的全部数字,交给 UI 做接地过滤(整局/单人两模式:
  // 整局锐评同样会编数字,真机 301041798766)
  options.onStage2Material?.(extractNumbers(prompt))

  // 模型远程可配;缓存键带模型名,换模型后旧文本自动失效
  const model = await resolveModel('matchCritique', STAGE2_MODEL)
  const stage2Key = isPlayerMode
    ? `ai_match_detail_stage2_${snapshot.gameId}_${snapshot.modeContext.kind}_p${options.participantId}${snapshot.timeline ? '_tl' : ''}_${model}`
    : `ai_match_detail_stage2_${snapshot.gameId}_${snapshot.modeContext.kind}${snapshot.timeline ? '_tl' : ''}_${model}`
  const cachedMarkdown = readStage2Cache(stage2Key)
  if (cachedMarkdown) {
    callbacks.onChunk(cachedMarkdown)
    callbacks.onDone()
    return { ok: true, attribution, markdown: cachedMarkdown }
  }

  const res = await streamMarkdown(prompt, model, callbacks.onChunk)
  if (!res.ok) {
    // 先 onError 再返回 fallbackMarkdown；调用方（services/ai/index.ts）会兜底渲染
    callbacks.onError(res.error)
    return {
      ok: false,
      stage: 'critique',
      error: res.error,
      attribution,
      fallbackMarkdown: renderFallbackCritique(attribution)
    }
  }
  callbacks.onDone()
  writeStage2Cache(stage2Key, res.text)
  return { ok: true, attribution, markdown: res.text }
}
