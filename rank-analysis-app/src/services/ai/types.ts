/**
 * AI 分析模块公共类型
 */

import type { AIAnalysisReport } from './matchDetail'

export type MatchDetailAnalysisMode = 'overview' | 'player'

export interface MatchDetailAnalysisOptions {
  mode?: MatchDetailAnalysisMode
  participantId?: number
}

export interface AIAnalysisResult {
  success: boolean
  content?: string
  error?: string
}

/** DashScope 流末 usage（Rust 端已归一化为 camelCase） */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void
  onDone: () => void
  onError: (error: string) => void
  /** D-P1：流末 token 用量事件（含 usage 的流才会触发） */
  onUsage?: (usage: AiUsage) => void
  /** D-P1：matchDetail 双阶段流水线成功时回调结构化报告（此时不再流式文本）。 */
  onStructured?: (report: AIAnalysisReport) => void
}
