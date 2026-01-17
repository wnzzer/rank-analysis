import { MatchHistory } from '../record/MatchHistory.vue'
import { OneGamePlayer, Rank, Summoner, UserTag } from '../record/type'

export interface SessionData {
  phase: string
  type: string
  typeCn: string
  queueId: number
  teamOne: SessionSummoner[]
  teamTwo: SessionSummoner[]
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
