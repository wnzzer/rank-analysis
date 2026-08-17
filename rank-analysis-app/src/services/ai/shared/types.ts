/**
 * AI 共享层类型定义。
 */

export type TeamPosition = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'UNKNOWN'

export type ModeKind = 'ranked' | 'aram' | 'augment' | 'unknown'

export interface ModeContext {
  kind: ModeKind
  description: string
  hasLanes: boolean
  hasItemBuild: boolean
  hasAugmentSystem: boolean
  championAssignment: 'pick' | 'random' | 'random-with-bench'
  isTeamMode: boolean
}

export interface RecentPlayerProfile {
  positionDistribution: Array<{
    pos: TeamPosition
    ratio: number
    games: number
  }>
  /** 占比 ≥ 0.4 才认主玩，否则 'UNCLEAR' */
  mainPosition: TeamPosition | 'UNCLEAR'
  /** 本局位置在近期的占比，用于判断补位严重程度 */
  currentLanePlayedRatio: number

  championDistribution: Array<{
    championId: number
    name: string
    games: number
    winRate: number
    avgKda: number
  }>
  /**
   * 分位置英雄池：只统计玩家在本局位置（currentTeamPosition）打过的英雄，
   * 该位置场次 < 2 时回退为全位置口径（同 championDistribution 内容）。
   * 画像卡「常用英雄」小节渲染此字段——不看你中单 100 场，看你这场位置的场次。
   */
  positionChampionDistribution: Array<{
    championId: number
    name: string
    games: number
    winRate: number
    avgKda: number
  }>
  currentChampionMastery: {
    gamesInRecent: number
    winRate: number
    avgKda: number
    isOnetrick: boolean
    isFirstTimeInRecent: boolean
  } | null

  recentWinRate: number
  recentKda: number
  streak: { kind: 'win' | 'loss'; count: number } | null

  /** TS 算好的事实，AI 直接消费 */
  isOffRole: boolean
  offRoleSeverity: 'none' | 'mild' | 'severe'

  /** 使用者对该玩家的主观备注（[色档] 文本），可能不存在 */
  note?: string
}
