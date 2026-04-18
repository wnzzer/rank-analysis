/**
 * 对局会话领域模型：当前 session / 我方与敌方
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

/** teamOne = 我方（左），teamTwo = 敌方（右） */
export interface SessionData {
  phase: string
  type: string
  typeCn: string
  queueId: number
  teamOne: SessionSummoner[]
  teamTwo: SessionSummoner[]
}
