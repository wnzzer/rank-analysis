<template>
  <div class="user-record-card">
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
            </n-icon><span>联盟四区 </span>
          </n-flex>
        </n-flex>
      </n-flex>
    </n-card>

    <!-- 这里显示的是RANKED_SOLO_5x5的排名图标 -->
    <n-card :bordered="true">
      <n-flex>
        <div>
          <img width="70px" height="70px"
            :src="requireImg(summoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase() + '.png')" />
        </div>
        <div style="width: 60%;">
          
        </div>
      </n-flex>
    </n-card>
    <n-card :bordered="true">
      <n-flex>
        <div>
          <img width="70px" height="70px"
            :src="requireImg(summoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase() + '.png')" />
        </div>
        <div style="width: 60%;">
          
        </div>
      </n-flex>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import http from '@renderer/services/http';
import { CopyOutline, Server } from '@vicons/ionicons5'
import { onMounted, ref } from 'vue';

import { NCard, NFlex, NButton, NIcon, useMessage } from 'naive-ui';

// 定义 SummonerInfo 接口
interface Summoner {
  gameName: string;
  tagLine: string;
  summonerLevel: number;
  profileIconId: number;
  profileIconBase64: string;
  puuid: string;
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

onMounted(() => {
  getSummoner("")
})

const getSummoner = async (name: string) => {
  const res = await http.get<SummonerData>(
    "/GetSummonerByPuuid", {
    params: { name }
  }
  )
  console.log(res)
  summoner.value = res.data
}

/**
* Returns the image path for the given rank tier.
* This function dynamically requires the image based on the provided tier string,
* converting it to lowercase to ensure correct file name matching.
*
* @param {string} tier - The rank tier to get the image for.
* @returns {string} - The path to the rank tier image.
*/
const requireImg = (imgPath: string) => {
  console.log(imgPath)
  return new URL(`../../assets/imgs/tier/${imgPath}`, import.meta.url).href;
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
  height: 100vh;
}
</style>
