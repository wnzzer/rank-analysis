/**
 * 对局会话领域模型：subteams 统一模型
 * - CLASSIC 模式：subteams.length === 2，[0] 是我方，[1] 是敌方
 * - CHERRY 模式：
 *   - EOG 端点可用时（InProgress 中后期 / PreEndOfGame / EndOfGame）→ 权威分队，
 *     subteamId 1~N 与游戏内"队伍 N"一致（旧斗魂 8 队×2，新斗魂 6 队×3 等）
 *   - EOG 不可用时（ChampSelect、InProgress 早期）→ 回退到 lobby 的 teamParticipantId 分组。
 *     此时 cherrySubteamsPending = true，前端需持续轮询直到 EOG ready。
 *     注意：新斗魂 (queueId 1750+) 的 tpid 不再代表分队，fallback 数据完全不可信。
 */

import type { MatchHistory } from './match'
import type { OneGamePlayer, UserTag } from './analysis'
import type { Rank, Summoner } from './player'

export interface PreGroupMarkers {
  name: string
  type: string
}

export interface SessionSummoner {
  championId: number
  championKey: string
  summoner: Summoner
  matchHistory: MatchHistory
  userTag: UserTag
  rank: Rank
  meetGames: OneGamePlayer[]
  preGroupMarkers: PreGroupMarkers
  isLoading?: boolean
  /**
   * 选人状态：none/intent/picking/banning/locked（非选人期为空）
   */
  pickState?: string
  /**
   * 本局官方分配分路（LCU 小写命名 top/jungle/middle/bottom/utility）；
   * 仅选人期我方有值（敌方 LCU 恒为空），匹配/大乱斗等无分配模式为空
   */
  assignedPosition?: string
}

export interface Subteam {
  subteamId: number
  players: SessionSummoner[]
}

/**
 * 选人阶段的结构化视图：会话级阶段 + 双方已 ban 列表。
 * 由后端从 timer.phase + actions 推导，非选人期（无 ChampSelect 数据）整体缺席。
 */
export interface ChampSelect {
  /** 会话级阶段: planning(预选) | banning(禁用) | picking(选人) | finalization(确认) | ''(未知) */
  stage: string
  /** 我方已 ban 的英雄 id 列表 */
  myBans: number[]
  /** 敌方已 ban 的英雄 id 列表 */
  theirBans: number[]
}

export interface SessionData {
  phase: string
  type: string
  typeCn: string
  queueId: number
  gameMode: string
  isMultiTeam: boolean
  mySubteamId: number
  subteams: Subteam[]
  /**
   * CHERRY 模式下当前分队是否仍是占位数据（EOG 端点尚未返回权威 subteamId）。
   * true 时前端会持续轮询 get_session_data 直到 EOG 端点 ready。
   * CLASSIC 模式恒为 false。
   */
  cherrySubteamsPending?: boolean
  /**
   * 选人阶段结构化视图（阶段 + 双方 ban 列表）。
   * 仅 ChampSelect 期间存在；非选人期该字段整体缺席（后端 skip_serializing_if）。
   */
  champSelect?: ChampSelect
}
