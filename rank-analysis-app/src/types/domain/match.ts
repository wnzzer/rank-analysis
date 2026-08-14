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
  /** 新斗魂(queueId 1750+) 才会返回 5/6；旧斗魂未返回时为 0 */
  playerAugment5: number
  playerAugment6: number
  kills: number
  deaths: number
  assists: number
  /** 多杀次数（LCU/SGP 同名字段；旧缓存数据可能缺失，消费方需 `?? 0` 兜底） */
  doubleKills?: number
  tripleKills?: number
  quadraKills?: number
  pentaKills?: number
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
  /** CHERRY/斗魂模式：1~8 玩家所属小队 ID；非 CHERRY 局为 0 */
  playerSubteamId: number
  /** CHERRY/斗魂模式：1~8 小队最终名次（1=冠军）；非 CHERRY 局为 0 */
  subteamPlacement: number
}

export interface GamePerkSelection {
  perk: number
  var1: number
  var2: number
  var3: number
}

export interface GamePerkStyle {
  /** 主系 primaryStyle / 副系 subStyle（LCU 提供，SGP 可能缺） */
  description?: string
  style: number
  selections: GamePerkSelection[]
}

/** 完整符文页：LCU match-details `participants[].perks`（SGP match-v5 同构） */
export interface GamePerks {
  statPerks?: { defense: number; flex: number; offense: number }
  styles: GamePerkStyle[]
}

export interface Participant {
  win: boolean
  participantId: number
  teamId: number
  championId: number
  spell1Id: number
  spell2Id: number
  /** 完整符文页（styles 全量 + statPerks）；旧缓存/缺失时为 undefined，回退 stats 扁平字段 */
  perks?: GamePerks
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
  /** LCU 下发版本号（如 "25.6.1.123"）；老记录可能缺失 */
  gameVersion?: string
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
