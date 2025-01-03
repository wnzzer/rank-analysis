<template>
  <n-flex vertical style="height: 100%;">
    <RecordCard v-for="(game, index) in matchHistory?.games?.games || []" :key="index" :record-type="true" :games="game"
      style="flex: 1; display: flex;">
    </RecordCard>
    <div>
      <!-- 自定义分页组件 -->
      <n-pagination style="margin-top: 0px;">
        <template #prev> <n-button size="tiny">
            <template #icon>
              <n-icon>
                <ArrowBack></ArrowBack>
              </n-icon>
            </template>
          </n-button> </template>
        <template #next> <n-button size="tiny">
            <template #icon>
              <n-icon>
                <ArrowForward></ArrowForward>
              </n-icon>
            </template>
          </n-button></template>
      </n-pagination>
    </div>
  </n-flex>
</template>
<script setup lang="ts">

import http from '@renderer/services/http';
import RecordCard from './RecordCard.vue';
import { ArrowBack, ArrowForward } from '@vicons/ionicons5';
import { onMounted, ref } from 'vue';


onMounted(async () => {
  await getHistoryMatch();
});

/**
 * Interface representing a player's match history.
 * @property {string} platformId - The ID of the platform where the matches were played.
 * @property {Object} games - An object containing an array of game details.
 * @property {Array<Object>} games.games - An array of game objects, each containing details about a single match.
 * @property {number} games.games.gameId - The unique identifier for the game.
 * @property {string} games.games.gameCreationDate - The date and time the game was created.
 * @property {number} games.games.gameDuration - The duration of the game in seconds.
 * @property {Array<Object>} games.games.participants - An array of participant objects, each representing a player in the game.
 * @property {boolean} games.games.participants.win - Indicates whether the participant won the game.
 * @property {number} games.games.participants.stats.kills - The number of kills the participant achieved.
 * @property {number} games.games.participants.stats.deaths - The number of deaths the participant had.
 * @property {number} games.games.participants.stats.assists - The number of assists the participant provided.
 * @property {number} games.games.participants.stats.goldEarned - The total gold earned by the participant during the game.
 */
export interface GameDetail {
  endOfGameResult: string;
  participantIdentities: {
    player: {
      accountId: string;
      platformId: string;
      gameName : string;
      tagLine : string;
      summonerName: string;
      summonerId: string;
    };
  }[];
  participants: {
    teamId: number;
    participantId: number;
    championId: number;
    championBase64: string;

    summonerName: string;
    summonerId: string;
  }[];
}

// 参与者的类型
export interface ParticipantStats {
  win: boolean;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  item0Base64: string;
  item1Base64: string;
  item2Base64: string;
  item3Base64: string;
  item4Base64: string;
  item5Base64: string;
  item6Base64: string;
  perkPrimaryStyle: number;
  perkSubStyle: number;
  perkPrimaryStyleBase64: string;
  perkSubStyleBase64: string;
  kills: number;
  deaths: number;
  assists: number;
  goldEarned: number;
  goldSpent: number;
  totalDamageDealtToChampions: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHeal: number;
  totalMinionsKilled: number;
}

// 参与者类型
export interface Participant {
  win: boolean;
  participantId: number;
  teamId: number;
  championId: number;
  championBase64: string;
  spell1Id: number;
  spell1Base64: string;
  spell2Id: number;
  spell2Base64: string;
  stats: ParticipantStats;
}

// 每场游戏的类型
export interface Game {
  gameDetail: GameDetail;
  gameId: number;
  gameCreationDate: string;
  gameDuration: number;
  gameMode: string;
  gameType: string;
  mapId: number;
  queueId: number;
  queueName: number;
  participants: Participant[];
}



// 最外层的 MatchHistory 类型
export interface MatchHistory {
  platformId: string;
  games: {
    gameDetail: GameDetail;
    games: Game[];  // 使用 Game 类型替代原来的嵌套结构
  };
}


const matchHistory = ref<MatchHistory>()



const getHistoryMatch = async () => {
  const res = await http.get<MatchHistory>(
    "/GetMatchHistory", {
    params: {}
  })
  matchHistory.value = res.data;

};

</script>
