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
