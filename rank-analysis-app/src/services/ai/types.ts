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

export interface StreamCallbacks {
  onChunk: (chunk: string) => void
  onDone: () => void
  onError: (error: string) => void
  /** D-P1：matchDetail 双阶段流水线成功时回调结构化报告（此时不再流式文本）。 */
  onStructured?: (report: AIAnalysisReport) => void
}
