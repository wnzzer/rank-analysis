/**
 * matchDetail 模块的核心类型。
 *
 * AttributionResult 是 Stage 1 的输出契约：一组 verdict，每条带数字证据 + 申辩。
 * Stage 2 消费 AttributionResult 转写为面向用户的 markdown 锐评。
 */

export type VerdictLabel = '尽力' | '犯罪' | '被爆' | '被连累' | '缚地灵' | '正常'

export type MitigatingFactorKind =
  | 'off-role'
  | 'first-time-champion'
  | 'team-collapse'
  | 'targeted'

export interface MitigatingFactor {
  factor: MitigatingFactorKind
  /** 描述支持该 factor 成立的数据点（必须能与 snapshot 对得上） */
  support: string
}

export interface EvidenceMetric {
  /** 指标名，如 'kda' / 'damageShare' / 'killParticipation' */
  metric: string
  /** 数值，已格式化为 number；占比类用小数或百分比都可，validator 不强约束 */
  value: number
  /** 队内或全场排名（1=最高） */
  teamRank?: number
  /** 人话注释 */
  note?: string
}

export interface Verdict {
  participantId: number
  name: string
  label: VerdictLabel
  evidenceMetrics: EvidenceMetric[]
  mitigatingFactors: MitigatingFactor[]
  finalCall: string
}

export interface AttributionResult {
  /** 胜负核心因果链，2-3 句 */
  winReason: string
  verdicts: Verdict[]
}

/** Stage 2 输出（目前就是一段 markdown，留出 type alias 以便未来扩展） */
export type CritiqueMarkdown = string

/** UI state machine 用 */
export type MatchAIState =
  | 'idle'
  | 'profiles'
  | 'attribution'
  | 'critique'
  | 'done'
  | 'error'
