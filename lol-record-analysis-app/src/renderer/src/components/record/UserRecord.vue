<template>
  <n-flex vertical style="display: flex; position: relative; height: 100%;">
    <n-card :bordered="false">
      <n-flex>
        <div style="position: relative;">
          <img width="50px" height="50px" :src="summoner.summoner.profileIconBase64">
          <div
            style="position: absolute; bottom: 0; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
            {{ summoner.summoner.summonerLevel }}
          </div>
        </div>
        <n-flex vertical>
          <n-flex>
            <span style="font-size: medium; font-weight: 1000;">{{ summoner.summoner.gameName }}</span>
            <n-button text style="font-size: 12px" @click="copy">
              <n-icon>
                <copy-outline></copy-outline>
              </n-icon>
            </n-button>
          </n-flex>

          <n-flex>
            <span style="color: #676768; font-size: small;">#{{ summoner.summoner.tagLine }}</span>
            <n-icon :depth="3" color="dark">
              <server></server>
            </n-icon><span>{{ summoner.summoner.platformIdCn }} </span>
          </n-flex>
        </n-flex>
      </n-flex>
    </n-card>

    <!-- 这里显示的是RANKED_SOLO_5x5的排名图标 -->
    <div style="position: relative;">

      <n-card :bordered="false" content-style="padding-top:0px">

        <n-flex>
          <div>
          </div>
          <div>
            <n-button style="margin: 5px;" v-for="i in 5" :key="i" size="tiny" type="primary">
              六连胜
            </n-button>

          </div>
        </n-flex>
      </n-card>
    </div>
    <div style="position: relative;">

      <n-card :bordered="false">
        <div style="position: absolute; left: 0;top: 0;">

          <span>
            单双排
          </span>
        </div>
        <n-flex>
          <div>
            <img width="70px" height="70px"
              :src="requireImg(summoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase() )" />
          </div>
          <div style="width: 60%;">
            <n-flex vertical>
              <RecordButton
                :record-type="getRecordType(summoner.rank.queueMap.RANKED_SOLO_5x5.wins, summoner.rank.queueMap.RANKED_SOLO_5x5.losses)">
                胜率：{{ getWinRate(summoner.rank.queueMap.RANKED_SOLO_5x5.wins,
                  summoner.rank.queueMap.RANKED_SOLO_5x5.losses) }}
              </RecordButton>
              <n-button size="tiny">胜场：{{ summoner.rank.queueMap.RANKED_SOLO_5x5.wins }}</n-button>
              <n-button size="tiny">负场：{{ summoner.rank.queueMap.RANKED_SOLO_5x5.losses }}</n-button>
            </n-flex>
          </div>
        </n-flex>
      </n-card>
    </div>
    <div style="position: relative;">

      <n-card :bordered="false">
        <n-flex>
          <div style="position: absolute; left: 0;top: 0;">

            <span>
              灵活组排
            </span>
          </div>
          <div>
            <img width="70px" height="70px"
              :src="requireImg(summoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase() )" />
          </div>
          <div style="width: 60%;">
            <n-flex vertical>
              <RecordButton
                :record-type="getRecordType(summoner.rank.queueMap.RANKED_FLEX_SR.wins, summoner.rank.queueMap.RANKED_FLEX_SR.losses)">
                胜率：{{
                  getWinRate(summoner.rank.queueMap.RANKED_FLEX_SR.wins, summoner.rank.queueMap.RANKED_FLEX_SR.losses) }}
              </RecordButton>
              <n-button size="tiny">胜场：{{ summoner.rank.queueMap.RANKED_FLEX_SR.wins }}</n-button>
              <n-button size="tiny">负场：{{ summoner.rank.queueMap.RANKED_FLEX_SR.losses }}</n-button>
            </n-flex>

          </div>
        </n-flex>
      </n-card>
    </div>
    <!-- 这里显示的是RANKED_SOLO_5x5的排名图标 -->
    <div style="position: relative;  flex: 1; flex-grow: 1;">

      <n-card :bordered="true" style=" flex: 1; flex-grow: 1;">
        
        <n-flex>
          <div>
          </div>
          <div>


          </div>
        </n-flex>
      </n-card>
    </div>


  </n-flex>
</template>

<script setup lang="ts">
import http from '@renderer/services/http';
import { CopyOutline, Server, HeartDislike } from '@vicons/ionicons5'
import { onMounted, ref } from 'vue';

import { NCard, NFlex, NButton, NIcon, useMessage } from 'naive-ui';
import RecordButton from './RecordButton.vue';
import { useRoute } from 'vue-router';

// 定义 SummonerInfo 接口
interface Summoner {
  gameName: string;
  tagLine: string;
  summonerLevel: number;
  profileIconId: number;
  profileIconBase64: string;
  puuid: string;
  platformIdCn: string,

}

// 定义 QueueInfo 接口
interface QueueInfo {
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
interface Rank {
  queueMap: {
    RANKED_SOLO_5x5: QueueInfo;
    RANKED_FLEX_SR: QueueInfo;
  };
}

// 整体数据结构接口
interface SummonerData {
  summoner: Summoner;
  rank: Rank;
}

const summoner = ref<SummonerData>({
  summoner: {
    gameName: "",
    tagLine: "",
    summonerLevel: 0,
    profileIconId: 0,
    profileIconBase64: "",
    puuid: "",
    platformIdCn: ''
  },
  rank: {
    queueMap: {
      RANKED_SOLO_5x5: {
        queueType: "",
        queueTypeCn: "",
        division: "",
        tier: "",
        tierCn: "",
        highestDivision: "",
        highestTier: "",
        isProvisional: false,
        leaguePoints: 0,
        losses: 0,
        wins: 0,
      },
      RANKED_FLEX_SR: {
        queueType: "",
        queueTypeCn: "",
        division: "",
        tier: "",
        tierCn: "",
        highestDivision: "",
        highestTier: "",
        isProvisional: false,
        leaguePoints: 0,
        losses: 0,
        wins: 0,
      },
    },
  },
})

const route = useRoute()
let name = ""

onMounted(() => {
  name = route.query.name as string
  getSummoner(name)
})

const getSummoner = async (name: string) => {
  const res = await http.get<SummonerData>(
    "/GetSummoner", {
    params: { name }
  }
  )
  console.log(res)
  summoner.value = res.data
}
const getWinRate = (win: number, loss: number) => {

  // 首先检查是否有比赛记录，如果没有则胜率为0
  if (win + loss === 0) {
    return 0;
  }
  // 计算胜率并转换为百分比形式
  const winRate = (win / (win + loss)) * 100;
  // 返回胜率，保留整数部分
  const value = Math.round(winRate) == 100 ? "--" : Math.round(winRate) + "%";
  return value;
};
const getRecordType = (win, loss) => {

  // 首先检查是否有比赛记录，如果没有则胜率为0
  if (loss === 0) {
    return '';
  }
  // 计算胜率并转换为百分比形式
  const winRate = (win / (win + loss)) * 100; 
  if(loss === 0) {
    return ''
  }

  if (winRate >= 58) {
    return 'good'
  } else if (winRate <= 49) {
    return 'bad'
  } else {
    return ''
  }

}
/**
* Returns the image path for the given rank tier.
* This function dynamically requires the image based on the provided tier string,
* converting it to lowercase to ensure correct file name matching.
*
* @param {string} tier - The rank tier to get the image for.
* @returns {string} - The path to the rank tier image.
*/
const requireImg = (tier: string) => {
  // 处理tier为空或为null的情况
  const tierNormalized = tier ? tier.toLocaleLowerCase() : 'unranked';
  const imgPath = `../../assets/imgs/tier/${tierNormalized}.png`;
  
  // 输出图片路径进行调试
  console.log(imgPath);
  
  // 返回图片的URL
  return new URL(imgPath, import.meta.url).href;
};
const message = useMessage();
const copy = () => {
  navigator.clipboard.writeText(summoner.value.summoner.gameName + "#" + summoner.value.summoner.tagLine)
    .then(() => {
      message.success("复制成功");
    })
    .catch(() => {
      message.error("复制失败");
    });
}
</script>

<style lang="css" scoped>
.user-record-card {
  height: 100%;
}
</style>
