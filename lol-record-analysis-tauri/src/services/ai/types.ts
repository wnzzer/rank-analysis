/**
 * AI 分析模块公共类型
 */

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
}
