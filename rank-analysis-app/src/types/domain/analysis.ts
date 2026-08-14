/**
 * 战绩分析聚合模型：最近表现、好友宿敌、标签
 */

import type { Summoner } from './player'

export interface OneGamePlayer {
  gameCreatedAt: string
  index: number
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

export interface OneGamePlayerSummoner {
  winRate: number
  wins: number
  losses: number
  Summoner: Summoner
  OneGamePlayer: OneGamePlayer[]
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

import { defaultSummoner } from './player'

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
  /** 趋势聚合的有效样本场次（0 = 无样本，前端据此降级展示） */
  samples: number
  /** 平均补刀速率（每分钟，含野怪，保留 1 位小数） */
  averageCsPerMin: number
  /** 平均视野得分（保留 1 位小数） */
  averageVisionScore: number
  oneGamePlayers: Record<string, OneGamePlayer[]>
  friendAndDispute: FriendAndDispute
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
    samples: 0,
    averageCsPerMin: 0,
    averageVisionScore: 0,
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
