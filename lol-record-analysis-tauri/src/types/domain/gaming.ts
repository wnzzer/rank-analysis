/**
 * 对局会话领域模型：subteams 统一模型
 * - CLASSIC 模式：subteams.length === 2，[0] 是我方，[1] 是敌方
 * - CHERRY 模式：
 *   - EOG 端点可用时（InProgress / PreEndOfGame / EndOfGame）→ subteams.length === 8，
 *     subteamId 1~8 与游戏内"队伍 N"权威一致
 *   - EOG 不可用时（如 ChampSelect）→ 回退到 lobby 的 teamParticipantId 分组，
 *     subteamId 重映射成 1..N（N 可能 >8，因为 lobby tpid 实测稀疏）
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
}

export interface Subteam {
  subteamId: number
  players: SessionSummoner[]
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
}
