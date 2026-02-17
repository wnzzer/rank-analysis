import { MatchHistory } from '../record/MatchHistory.vue'
import { OneGamePlayer, Rank, Summoner, UserTag } from '../record/type'

/** 一方队伍：红/蓝队标记 + 玩家列表 */
export interface TeamSideData {
  side: string // 'blue' | 'red'
  players: SessionSummoner[]
}

export interface SessionData {
  phase: string
  type: string
  typeCn: string
  queueId: number
  teamOne: TeamSideData
  teamTwo: TeamSideData
}
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
