<template>
  <n-flex vertical style="height: 100%;">
    <RecordCard v-for="(game, index) in matchHistory?.games?.games || []" :key="index" :record-type="true" :games="game"
      style="flex: 1; display: flex;">
    </RecordCard>
    <div>
      <!-- 自定义分页组件 -->
      <n-pagination style="margin-top: 10px;">
        <template #prev> <n-button size="tiny">
            <template #icon>
              <n-icon>
                <ArrowBack></ArrowBack>
              </n-icon>
            </template>
          </n-button> </template>
        <template #next>  <n-button size="tiny">
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
import { ArrowBack ,ArrowForward} from '@vicons/ionicons5';
import { onMounted, ref } from 'vue';


onMounted(async () => {
  await getHistoryMatch();
});

interface MatchHistory {
  platformId: string;
  games: {
    games: Array<{
      gameId: number;
      gameCreationDate: string;
      gameDuration: number;
      gameMode: string;
      gameType: string;
      mapId: number;
      queueId: number;
      participants: Array<{
        participantId: number;
        teamId: number;
        championId: number;
        championBase64: string;

        spell1Id: number;
        spell2Id: number;
        stats: {
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
          totalDamageDealt: number;
          totalDamageTaken: number;
          totalHeal: number;
          totalMinionsKilled: number;
        };
      }>;
    }>;
  };
}

const matchHistory = ref<MatchHistory>(
  {
    platformId: "",
    games: {
      games: [{
        gameId: 0,
        gameCreationDate: "",
        gameDuration: 0,
        gameMode: "",
        gameType: "",
        mapId: 0,
        queueId: 0,
        participants: [{
          participantId: 0,
          teamId: 0,
          championId: 0,
          championBase64: "",

          spell1Id: 0,
          spell2Id: 0,
          stats: {
            win: false,
            item0: 0,
            item1: 0,
            item2: 0,
            item3: 0,
            item4: 0,
            item5: 0,
            item6: 0,
            item0Base64: "",
            item1Base64: "",
            item2Base64: "",
            item3Base64: "",
            item4Base64: "",
            item5Base64: "",
            item6Base64: "",
            perkPrimaryStyle: 0,
            perkSubStyle: 0,
            perkPrimaryStyleBase64: "",
            perkSubStyleBase64: "",
            kills: 0,
            deaths: 0,
            assists: 0,
            goldEarned: 0,
            goldSpent: 0,
            totalDamageDealt: 0,
            totalDamageTaken: 0,
            totalHeal: 0,
            totalMinionsKilled: 0,
          }
        }]
      }]
    }
  }
)



const getHistoryMatch = async () => {
  const res = await http.get<MatchHistory>(
    "/GetMatchHistory", {
    params: {}
  })
  matchHistory.value = res.data;

};

</script>
