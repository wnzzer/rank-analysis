<template>
  <n-flex vertical style="display: flex; position: relative; height: 100%;">
    <n-card :bordered="false">
      <n-flex>
        <div style="position: relative;">
          <img width="50px" height="50px" :src="assetPrefix + summoner.summoner.profileIconKey" />
          <div
            style="position: absolute; bottom: 0; right: 0; font-size: 10px; width: 25px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
            {{ summoner.summoner.summonerLevel }}
          </div>
        </div>
        <n-flex vertical>
          <n-flex>
            <span style="font-size: medium; font-weight: 1000;">
              <n-ellipsis style="max-width: 128px">
                {{ summoner.summoner.gameName }}
              </n-ellipsis>
            </span>
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


    <div style="position: relative;">
      <n-card :bordered="false" content-style="padding-top:0px">

        <n-flex>
          <div>
          </div>
          <div>

            <n-tooltip trigger="hover" v-for="tag in tags">
              <template #trigger>
                <n-button style="margin: 5px;" size="tiny" :type="tag.good ? 'primary' : 'error'">
                  {{ tag.tagName }}
                </n-button> </template>
              <span>{{ tag.tagDesc }}</span>
            </n-tooltip>


          </div>
        </n-flex>
      </n-card>
    </div>
    <!-- 宿敌和好友 -->
    <n-flex style="display: flex;">
      <n-flex vertical style="flex: 1">
        <div v-if="recentData.friendAndDispute.friendsSummoner" style="font-weight: 800; color:#8BDFB7;">
          <n-icon>
            <Accessibility />
          </n-icon>
          好友/胜率
        </div>
        <n-popover trigger="hover" v-for="friend in recentData.friendAndDispute.friendsSummoner">
          <template #trigger>
            <n-tag round :bordered="false" :color="{ textColor: winRateColor(friend.winRate) }">
              <n-ellipsis style="max-width: 90px">
                {{ friend.Summoner.gameName }}
              </n-ellipsis>

              <span style="font-size: 13px; margin-left: 5px;">{{ friend.winRate }}</span>
              <template #avatar>
                <n-avatar :src="assetPrefix + friend.Summoner.profileIconKey" />
              </template>
            </n-tag>
          </template>
          <MettingPlayersCard :meet-games="friend.OneGamePlayer"></MettingPlayersCard>
        </n-popover>
      </n-flex>
      <n-flex vertical style="flex: 1">
        <div v-if="recentData.friendAndDispute.disputeSummoner" style="font-weight: 800; color:#C9606F;">
          <n-icon>
            <Skull />
          </n-icon>
          宿敌/胜率
        </div>
        <n-popover trigger="hover" v-for="dispute in recentData.friendAndDispute.disputeSummoner">
          <template #trigger>
            <n-tag round :bordered="false" :color="{ textColor: winRateColor(dispute.winRate) }">
              <n-ellipsis style="max-width: 90px">
                {{ dispute.Summoner.gameName }}
              </n-ellipsis>
              <span style="font-size: 13px; margin-left: 5px;">{{ dispute.winRate }}</span>
              <template #avatar>
                <n-avatar :src="assetPrefix + dispute.Summoner.profileIconKey" />
              </template>
            </n-tag>
          </template>
          <MettingPlayersCard :meet-games="dispute.OneGamePlayer"></MettingPlayersCard>
        </n-popover>
      </n-flex>
    </n-flex>




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
              :src="requireImg(summoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase())" />
          </div>
          <div style="position: absolute; bottom: 10px; left: 25px;">
            <span style="font-size: 12px;">
              {{ summoner.rank.queueMap.RANKED_SOLO_5x5.tierCn }} {{ summoner.rank.queueMap.RANKED_SOLO_5x5.division }}
            </span>
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
              :src="requireImg(summoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase())" />
          </div>
          <div style="position: absolute; bottom: 10px; left: 25px;">
            <span style="font-size: 12px;">
              {{ summoner.rank.queueMap.RANKED_FLEX_SR.tierCn }} {{ summoner.rank.queueMap.RANKED_FLEX_SR.division }}
            </span>
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
    <!-- 20场统计 -->
    <n-card class="recent-card" :bordered="false" content-style="padding:10px">
      <n-flex vertical style="position: relative; ">
        <n-flex>
          <div class="stats-title">最近表现</div>
          <div> <n-dropdown trigger="hover" :options="modeOptions" :on-select ="updateModel" :show-arrow="false">
              <n-button round size="tiny">{{ mode }}</n-button>
            </n-dropdown>
          </div>
        </n-flex>

        <n-flex class="stats-item" justify="space-between">

          <span class="stats-label">
            <n-flex style="gap: 5px;">
              <n-progress style=" width: 12px; position: relative; bottom: 5px; " type="circle" :show-indicator="false"
                :percentage="70" :height="24" status="success" color="bule" />

              <span>KDA:</span>
            </n-flex>
          </span>
          <span class="stats-value">
            <n-flex>
              <span :style="{ color: kdaColor(recentData.kda) }">{{
                recentData.kda
              }}</span>
              <span>
                <span :style="{ color: killsColor(recentData.kills) }">
                  {{ recentData.kills }}
                </span>
                /
                <span :style="{ color: deathsColor(recentData.deaths) }">{{ recentData.deaths }}</span>
                /
                <span :style="{ color: assistsColor(recentData.assists) }">{{ recentData.assists }}</span>
              </span>

            </n-flex>
          </span>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"><n-icon>
            </n-icon> 胜率：</span>
          <n-flex>
            <span style="width: 65px;" :style="{ color: winRateColor(winRate(recentData.selectWins,recentData.selectLosses)) }"> <n-progress type="line"
                :percentage="winRate(recentData.selectWins,recentData.selectLosses)" :height="6" :show-indicator="false"
                :color="winRateColor(winRate(recentData.selectWins,recentData.selectLosses))" processing :stroke-width="10"
                style="position: relative; top: 7px;"></n-progress>
            </span>
            <span class="stats-value" :style="{ color: winRateColor(winRate(recentData.selectWins,recentData.selectLosses)) }">{{ winRate(recentData.selectWins,recentData.selectLosses)}}%</span>

          </n-flex>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"><n-icon>
              <Accessibility></Accessibility>
            </n-icon> 参团率：</span>
          <n-flex>
            <span style="width: 65px;" :style="{ color: groupRateColor(recentData.groupRate) }"> <n-progress type="line"
                :percentage="recentData.groupRate" :height="6" :show-indicator="false"
                :color="groupRateColor(recentData.groupRate)" processing :stroke-width="10"
                style="position: relative; top: 7px;"></n-progress>
            </span>
            <span class="stats-value" :style="{ color: groupRateColor(recentData.groupRate) }">{{ recentData.groupRate
            }}%</span>

          </n-flex>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"> 伤害/占比：</span>
          <span class="stats-value">
            <n-flex>
              <span>
                {{ recentData.averageDamageDealtToChampions }}
              </span>
              <span style="width: 45px;"> <n-progress type="line" :percentage="recentData.damageDealtToChampionsRate"
                  :color="otherColor(recentData.damageDealtToChampionsRate)" :height="6" :show-indicator="false"
                  processing :stroke-width="13" style="position: relative; top: 7px;"></n-progress>
              </span>
              <span class="stats-value" :style="{ color: otherColor(recentData.damageDealtToChampionsRate) }">
                {{ recentData.damageDealtToChampionsRate }}%

              </span>
            </n-flex>
          </span>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"> 经济/占比：</span>
          <n-flex>
            <span class="stats-value">{{ recentData.averageGold }} </span>

            <span style="width: 45px;"> <n-progress type="line" :percentage="recentData.goldRate" :height="6"
                :color="otherColor(recentData.goldRate)" :show-indicator="false" processing :stroke-width="13"
                style="position: relative; top: 7px;"></n-progress>
            </span>
            <span class="stats-value" :style="{ color: otherColor(recentData.goldRate) }">
              {{ recentData.goldRate }}%

            </span>
          </n-flex>
        </n-flex>




      </n-flex>
    </n-card>


  </n-flex>
</template>

<script lang="ts" setup>
import http from '../../services/http';
import { assetPrefix } from '../../services/http';
import { CopyOutline, Server, Accessibility, Skull } from '@vicons/ionicons5'
import { onMounted, ref } from 'vue';
import MettingPlayersCard from '../gaming/MettingPlayersCard.vue'
import { NCard, NFlex, NButton, NIcon, useMessage } from 'naive-ui';
import RecordButton from './RecordButton.vue';
import { useRoute } from 'vue-router';
import { RankTag, RecentData, SummonerData, UserTag } from './type';
import { winRate,kdaColor, deathsColor, assistsColor, otherColor, groupRateColor, killsColor, winRateColor,modeOptions } from './composition';
import unranked from '../../assets/imgs/tier/unranked.png';
import bronze from '../../assets/imgs/tier/bronze.png';
import silver from '../../assets/imgs/tier/silver.png';
import gold from '../../assets/imgs/tier/gold.png';
import platinum from '../../assets/imgs/tier/platinum.png';
import diamond from '../../assets/imgs/tier/diamond.png';
import master from '../../assets/imgs/tier/master.png';
import grandmaster from '../../assets/imgs/tier/grandmaster.png';
import challenger from '../../assets/imgs/tier/challenger.png';
import iron from '../../assets/imgs/tier/iron.png';
import emerald from '../../assets/imgs/tier/emerald.png';




const summoner = ref<SummonerData>({
  summoner: {
    gameName: "",
    tagLine: "",
    summonerLevel: 0,
    profileIconId: 0,
    profileIconKey: "",
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
  getTags(name, 0)
})

const getSummoner = async (name: string) => {
  const res = await http.get<SummonerData>(
    "/GetSummonerAndRank", {
    params: { name }
  }
  )
  summoner.value = res.data
}

const mode = ref("全部")
const updateModel = (key: number,option: { label: string; }) => {
  getTags(name,key)
  mode.value = option.label
}
const recentData = ref<RecentData>({
  kda: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  wins: 0,
  losses: 0,
  flexWins: 0,
  flexLosses: 0,
  groupRate: 0,
  averageGold: 0,
  goldRate: 0,
  averageDamageDealtToChampions: 0,
  damageDealtToChampionsRate: 0,
  oneGamePlayers: {},
  friendAndDispute: {
    friendsRate: 0,
    friendsSummoner: [],
    disputeRate: 0,
    disputeSummoner: []
  },
  selectMode: 0,
  selectModeCn: '',
  selectWins: 0,
  selectLosses: 0
})
const tags = ref<RankTag[]>([])
const getTags = async (name: string,mode : number) => {
  const res = await http.get<UserTag>(
    "/GetTag", {
    params: { name, mode }
  }
  )
  recentData.value = res.data.recentData
  tags.value = res.data.tag
  if ((res.data.recentData.wins) && (res.data.recentData.losses)) {
    summoner.value.rank.queueMap.RANKED_SOLO_5x5.wins = res.data.recentData.wins
    summoner.value.rank.queueMap.RANKED_SOLO_5x5.losses = res.data.recentData.losses
  }
  if ((res.data.recentData.flexWins) && (res.data.recentData.flexLosses)) {
    summoner.value.rank.queueMap.RANKED_FLEX_SR.wins = res.data.recentData.flexWins
    summoner.value.rank.queueMap.RANKED_FLEX_SR.losses = res.data.recentData.flexLosses
  }

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
const getRecordType = (win: number, loss: number) => {

  // 首先检查是否有比赛记录，如果没有则胜率为0
  if (loss === 0) {
    return '';
  }
  // 计算胜率并转换为百分比形式
  const winRate = (win / (win + loss)) * 100;
  if (loss === 0) {
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
  const tierImages: { [key: string]: any } = {
    unranked: unranked,
    bronze: bronze,
    silver: silver,
    gold: gold,
    platinum: platinum,
    diamond: diamond,
    master: master,
    grandmaster: grandmaster,
    challenger: challenger,
    iron: iron,
    emerald: emerald,
  };

  // 处理tier为空或为null的情况
  const tierNormalized = tier ? tier.toLocaleLowerCase() : 'unranked';

  // 返回对应图片路径，如果没有匹配到返回 unranked 图片
  return tierImages[tierNormalized] || unranked;
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

.des-title {
  font-size: 12px;
  color: #888;
}

.recent-card {
  background: var(--n-color);
  border-radius: 8px;
  font-size: 12px;
  color: var(--n-text-color);
}

.stats-title {
  font-weight: bold;
  margin-bottom: 8px;
}

.stats-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.stats-label {
  font-size: 12px;
  color: var(--n-text-color-3);
}

.stats-value {
  font-size: 12px;
  color: var(--n-text-color);
}

.up {
  color: var(--n-success-color);
  font-size: 12px;
}
</style>
