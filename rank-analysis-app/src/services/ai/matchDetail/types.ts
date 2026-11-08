/**
 * matchDetail 模块的核心类型。
 *
 * AttributionResult 是归因骨架：由 TS 评分模块确定性生成（scoredAttribution.ts），
 * Stage 2 消费它转写为面向用户的 markdown 锐评。
 */
import type { DeathKind } from '../shared/scoring/deathAttribution'
import type { ScoreLevel } from './plainScore'

export type VerdictLabel = '尽力' | '犯罪' | '被爆' | '被连累' | '缚地灵' | '正常'

export type MitigatingFactorKind = 'off-role' | 'first-time-champion' | 'team-collapse' | 'targeted'

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
  /** 引用的时间线卡片编号（如 D2）；validator 核对卡片存在、主体包含该玩家、value 出现在卡片数字里 */
  cardId?: string
}

export interface Verdict {
  participantId: number
  name: string
  label: VerdictLabel
  evidenceMetrics: EvidenceMetric[]
  mitigatingFactors: MitigatingFactor[]
  finalCall: string
  /**
   * 以下三个字段由 validator 从 snapshot 确定性回填（模型输出的值会被覆盖）：
   * Stage 2 锐评靠它们锚定英雄/分路/胜负，杜绝"下路写成中路"类编造。
   * participantId 不在快照时保持 undefined。
   */
  champion?: string
  /** LCU teamPosition 原值（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY/''） */
  teamPosition?: string
  teamResult?: '胜方' | '败方'
}

/** 评分拆解里的一条死亡归责（cardId 为对应 D 卡；无卡为 null） */
export interface ScoreDeathLine {
  cardId: string | null
  time: string
  kind: DeathKind
  responsibility: number
}

/**
 * 评分拆解里的一个分项
 * @property value - 分项分（单位：基准标准差，一位小数；仅内部使用，不进 prompt）
 * @property level - 等级词（喂模型）
 * @property stats - 驱动该分项的 1~2 条真实数据（喂模型）
 */
export interface ScorePart {
  key: string
  cn: string
  value: number
  level: ScoreLevel
  stats: string[]
}

/**
 * 单个玩家的评分拆解（prompt 只渲染其中的人话字段，见 renderScoreBlock）
 * @property total / band - 总分与分档（仅内部使用，不进 prompt）
 * @property role - 中文分路（如「下路（ADC）」「无分路」）
 * @property rank - 总分分位的人话（如「大约处于同位置玩家的后 35%」）
 * @property parts - 参与加总的分项
 * @property deaths - 无时间线为 null
 * @property deathSummary - 带责任的阵亡归类小结
 * @property mitigation - 成立的减责证据（仅 label 为被爆时填，其余为空）
 */
export interface ScoreBrief {
  total: number
  band: string
  label: VerdictLabel
  role: string
  rank: string
  parts: ScorePart[]
  deaths: ScoreDeathLine[] | null
  deathSummary: string
  mitigation: string[]
}

export interface AttributionResult {
  /** 胜负核心因果链，2-3 句 */
  winReason: string
  verdicts: Verdict[]
  /** 全员评分拆解（participantId → 拆解）；重开局等无评分场景缺省 */
  scores?: Record<number, ScoreBrief>
}

/** Stage 2 输出（目前就是一段 markdown，留出 type alias 以便未来扩展） */
export type CritiqueMarkdown = string

/** UI state machine 用 */
export type MatchAIState = 'idle' | 'profiles' | 'attribution' | 'critique' | 'done' | 'error'
