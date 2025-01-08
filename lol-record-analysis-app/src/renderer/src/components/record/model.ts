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