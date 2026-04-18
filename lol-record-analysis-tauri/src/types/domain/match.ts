/**
 * 对局领域模型：原始 LCU 对局、参与者、数据统计
 */

export interface MatchPlayerIdentity {
  player: {
    accountId: number | string
    platformId: string
    gameName: string
    tagLine: string
    summonerName: string
    summonerId: number | string
    puuid?: string
  }
}

export interface ParticipantStats {
  win: boolean
  item0: number
  item1: number
  item2: number
  item3: number
  item4: number
  item5: number
  item6: number
  perk0: number
  perkPrimaryStyle: number
  perkSubStyle: number
  playerAugment1: number
  playerAugment2: number
  playerAugment3: number
  playerAugment4: number
  kills: number
  deaths: number
  assists: number
  goldEarned: number
  goldSpent: number
  totalDamageDealtToChampions: number
  totalDamageDealt: number
  totalDamageTaken: number
  totalHeal: number
  totalMinionsKilled: number
  neutralMinionsKilled: number
  damageDealtToTurrets: number
  groupRate: number
  goldEarnedRate: number
  damageDealtToChampionsRate: number
  damageTakenRate: number
  healRate: number
}

export interface Participant {
  win: boolean
  participantId: number
  teamId: number
  championId: number
  spell1Id: number
  spell2Id: number
  stats: ParticipantStats
}

export interface GameDetail {
  endOfGameResult: string
  participantIdentities: MatchPlayerIdentity[]
  participants: Participant[]
}

export interface Game {
  mvp: string
  gameDetail: GameDetail
  gameId: number
  gameCreationDate: string
  gameDuration: number
  gameMode: string
  gameType: string
  mapId: number
  queueId: number
  queueName: string
  platformId: string
  participantIdentities: MatchPlayerIdentity[]
  participants: Participant[]
}

export interface MatchHistory {
  platformId: string
  begIndex: number
  endIndex: number
  games: {
    games: Game[]
  }
}
