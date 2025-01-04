<template>
  <n-flex vertical style="height: 100%; position: relative;">


    <RecordCard v-for="(game, index) in matchHistory?.games?.games || []" :key="index" :record-type="true" :games="game"
      style="flex: 1; display: flex;">
    </RecordCard>

    <!-- 自定义分页组件 -->
    <div>
      <n-pagination style="margin-top: 0px;">
        <template #prev>
          <n-button size="tiny" @click="prevPage" :disabled="page == 1">
            <template #icon>
              <n-icon>
                <ArrowBack></ArrowBack>
              </n-icon>
            </template>
          </n-button>
        </template>
        <template #label>
          <span>{{ page }}</span>
        </template>
        <template #next>
          <n-button size="tiny" @click="nextPage">
            <template #icon>
              <n-icon>
                <ArrowForward></ArrowForward>
              </n-icon>
            </template>
          </n-button>
        </template>
      </n-pagination>
    </div>
  </n-flex>
</template>

<script setup lang="ts">
import http from '@renderer/services/http';
import RecordCard from './RecordCard.vue';
import { ArrowBack, ArrowForward } from '@vicons/ionicons5';
import { onMounted, ref } from 'vue';
import { useLoadingBar } from 'naive-ui';
import { useRoute } from 'vue-router';


// 类型定义
export interface GameDetail {
  endOfGameResult: string;
  participantIdentities: {
    player: {
      accountId: string;
      platformId: string;
      gameName: string;
      tagLine: string;
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
  participantIdentities: {
    player: {
      accountId: string;
      platformId: string;
      gameName: string;
      tagLine: string;
      summonerName: string;
      summonerId: string;
    };
  }[];
  participants: Participant[];
}

export interface MatchHistory {
  platformId: string;
  games: {
    gameDetail: GameDetail;
    games: Game[];
  };
}

const matchHistory = ref<MatchHistory>();

const loadingBar = useLoadingBar(); // 确保 useLoadingBar 在 setup 中正确调用

// 获取历史记录
const getHistoryMatch = async (name: string, begIndex: number, endIndex: number) => {
  loadingBar.start(); // 开始进度条

  try {
    const res = await http.get<MatchHistory>("/GetMatchHistory", {
      params: {
        begIndex: begIndex,
        endIndex: endIndex,
        name
      }
    });
    matchHistory.value = res.data;
    loadingBar.finish(); // 加载完成时结束进度条
  } catch (error) {
    loadingBar.error(); // 发生错误时显示错误状态
  } finally {
    loadingBar.finish(); // 加载完成时结束进度条
  }

};
const page = ref(1)
const nextPage = () => {
  getHistoryMatch("", (page.value) * 10, (page.value) * 10 + 9).then(() => {
    page.value++
  });
}
const prevPage = () => {
  getHistoryMatch("", (page.value - 2) * 10, (page.value - 2) * 10 + 9).then(() => {
    page.value--
  });

}

const route = useRoute()
let name = ""
onMounted(async () => {
  name = route.query.name as string
  await getHistoryMatch(name, 0, 9);
});
</script>
