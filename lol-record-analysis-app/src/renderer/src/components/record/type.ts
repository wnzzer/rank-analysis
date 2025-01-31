// 定义 SummonerInfo 接口
export interface Summoner {
    gameName: string;
    tagLine: string;
    summonerLevel: number;
    profileIconId: number;
    profileIconBase64: string;
    puuid: string;
    platformIdCn: string,
  
  }
  export function defaultSummoner(): Summoner {
    const summoner: Summoner = {
      gameName: "",
      tagLine: "",
      summonerLevel: 0,
      profileIconId: 0,
      profileIconBase64: "",
      puuid: "",
      platformIdCn: ''
    };
  
    return summoner
  }
  
  
  // 定义 QueueInfo 接口
  export interface QueueInfo {
    queueType: string;
    queueTypeCn: string;
    division: string;
    tier: string;
    tierCn: string;
    highestDivision: string;
    highestTier: string;
    isProvisional: boolean;
    leaguePoints: number;
    losses: number;
    wins: number;
  }
  
  // 定义 RankInfo 接口
  export interface Rank {
    queueMap: {
      RANKED_SOLO_5x5: QueueInfo;
      RANKED_FLEX_SR: QueueInfo;
    };
  }
  
  // 整体数据结构接口
  export interface SummonerData {
    summoner: Summoner;
    rank: Rank;
  }
  export interface RecentData {
    kda: number;
    kills: number;
    deaths: number;
    assists: number;
    wins: number;
    losses: number;
    flexWins: number;
    flexLosses: number;
    groupRate: number;
    averageGold: number;
    goldRate: number;
    averageDamageDealtToChampions: number;
    damageDealtToChampionsRate: number;
    oneGamePlayers: Record<string, OneGamePlayer[]>; // 对应 Go 中的 map[string][]OneGamePlayer
  }
  export interface OneGamePlayer {
    index: number;            // 用于标记第几页,第几个
    gameId: number;
    puuid: string;
    gameName: string;
    tagLine: string;
    championId: number;
    championBase64: string;
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
    isMyTeam: boolean;
}

  
  export interface RankTag {
    good: boolean;
    tagName: string;
    tagDesc: string;
  }
  
  export interface UserTag {
    recentData: RecentData;
    tag: RankTag[];
  }