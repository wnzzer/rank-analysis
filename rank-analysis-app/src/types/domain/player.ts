/**
 * 玩家领域模型：召唤师、段位、战绩聚合数据
 */

export interface Summoner {
  gameName: string
  tagLine: string
  summonerLevel: number
  profileIconId: number
  profileIconKey: string
  puuid: string
  platformIdCn: string
}

export function defaultSummoner(): Summoner {
  return {
    gameName: '',
    tagLine: '',
    summonerLevel: 0,
    profileIconId: 0,
    profileIconKey: '',
    puuid: '',
    platformIdCn: ''
  }
}

export interface QueueInfo {
  queueType: string
  queueTypeCn: string
  division: string
  tier: string
  tierCn: string
  highestDivision: string
  highestTier: string
  isProvisional: boolean
  leaguePoints: number
  losses: number
  wins: number
}

export function defaultQueueInfo(): QueueInfo {
  return {
    queueType: '',
    queueTypeCn: '',
    division: '',
    tier: '',
    tierCn: '',
    highestDivision: '',
    highestTier: '',
    isProvisional: false,
    leaguePoints: 0,
    losses: 0,
    wins: 0
  }
}

export interface Rank {
  queueMap: {
    RANKED_SOLO_5x5: QueueInfo
    RANKED_FLEX_SR: QueueInfo
  }
}

export function defaultRank(): Rank {
  return {
    queueMap: {
      RANKED_SOLO_5x5: defaultQueueInfo(),
      RANKED_FLEX_SR: defaultQueueInfo()
    }
  }
}

export interface RecentWinRate {
  wins: number
  losses: number
  winRate: number
}

export function defaultRecentWinRate(): RecentWinRate {
  return {
    wins: 0,
    losses: 0,
    winRate: 0
  }
}

export interface SummonerData {
  summoner: Summoner
  rank: Rank
}

export function defaultSummonerData(): SummonerData {
  return {
    summoner: defaultSummoner(),
    rank: defaultRank()
  }
}
