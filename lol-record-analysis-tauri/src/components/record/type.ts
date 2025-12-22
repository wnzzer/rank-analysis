// 定义 SummonerInfo 接口
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
  const summoner: Summoner = {
    gameName: '',
    tagLine: '',
    summonerLevel: 0,
    profileIconId: 0,
    profileIconKey: '',
    puuid: '',
    platformIdCn: ''
  }

  return summoner
}

// 定义 QueueInfo 接口
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

// 定义 RankInfo 接口
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

// 整体数据结构接口
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

export interface RecentData {
  kda: number
  kills: number
  deaths: number
  assists: number
  wins: number
  losses: number
  selectMode: number
  selectModeCn: string
  selectWins: number
  selectLosses: number
  flexWins: number
  flexLosses: number
  groupRate: number
  averageGold: number
  goldRate: number
  averageDamageDealtToChampions: number
  damageDealtToChampionsRate: number
  oneGamePlayers: Record<string, OneGamePlayer[]> // 对应 Go 中的 map[string][]OneGamePlayer
  friendAndDispute: FriendAndDispute
}
export interface OneGamePlayer {
  gameCreatedAt: string // 用于标记第几页,第几个
  index: number // 用于标记第几页,第几个
  gameId: number
  puuid: string
  gameName: string
  tagLine: string
  championId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  isMyTeam: boolean
  queueIdCn: string
}
export function defaultOneGamePlayer(): OneGamePlayer {
  return {
    gameCreatedAt: '',
    index: 0,
    gameId: 0,
    puuid: '',
    gameName: '',
    tagLine: '',
    championId: 0,
    win: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    isMyTeam: false,
    queueIdCn: ''
  }
}

export interface FriendAndDispute {
  friendsRate: number
  friendsSummoner: OneGamePlayerSummoner[]
  disputeRate: number
  disputeSummoner: OneGamePlayerSummoner[]
}
export function defaultFriendAndDispute(): FriendAndDispute {
  return {
    friendsRate: 0,
    friendsSummoner: [],
    disputeRate: 0,
    disputeSummoner: []
  }
}

export interface OneGamePlayerSummoner {
  winRate: number
  wins: number
  losses: number
  Summoner: Summoner // 需要根据实际api.Summoner结构定义
  OneGamePlayer: OneGamePlayer[]
}
export function defaultOneGamePlayerSummoner(): OneGamePlayerSummoner {
  return {
    winRate: 0,
    wins: 0,
    losses: 0,
    Summoner: defaultSummoner(),
    OneGamePlayer: []
  }
}

export interface RankTag {
  good: boolean
  tagName: string
  tagDesc: string
}
export function defaultRankTag(): RankTag {
  return {
    good: false,
    tagName: '',
    tagDesc: ''
  }
}

export function defaultRecentData(): RecentData {
  return {
    kda: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    wins: 0,
    losses: 0,
    selectMode: 0,
    selectModeCn: '',
    selectWins: 0,
    selectLosses: 0,
    flexWins: 0,
    flexLosses: 0,
    groupRate: 0,
    averageGold: 0,
    goldRate: 0,
    averageDamageDealtToChampions: 0,
    damageDealtToChampionsRate: 0,
    oneGamePlayers: {},
    friendAndDispute: defaultFriendAndDispute()
  }
}

export interface UserTag {
  recentData: RecentData
  tag: RankTag[]
}
export function defaultUserTag(): UserTag {
  return {
    recentData: defaultRecentData(),
    tag: []
  }
}
