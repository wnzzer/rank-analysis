<template>
  <n-flex vertical style="display: flex; position: relative; height: 100%">
    <n-card :bordered="false">
      <n-flex>
        <div style="position: relative">
          <img
            width="50px"
            height="50px"
            :src="`${assetPrefix}/profile/${summoner?.profileIconId}`"
          />
          <div
            style="
              position: absolute;
              bottom: 0;
              right: 0;
              font-size: 10px;
              width: 25px;
              height: 10px;
              text-align: center;
              line-height: 20px;
              border-radius: 50%;
              color: white;
            "
          >
            {{ summoner.summonerLevel }}
          </div>
        </div>
        <n-flex vertical>
          <n-flex>
            <span style="font-size: medium; font-weight: 1000">
              <n-ellipsis style="max-width: 128px">
                {{ summoner.gameName }}
              </n-ellipsis>
            </span>
            <n-button text style="font-size: 12px" @click="copy">
              <n-icon>
                <copy-outline></copy-outline>
              </n-icon>
            </n-button>
          </n-flex>

          <n-flex>
            <span style="color: #676768; font-size: small">#{{ summoner.tagLine }}</span>
            <n-icon :depth="3" color="dark"> <server></server> </n-icon
            ><span>{{ platformIdCn }} </span>
          </n-flex>
        </n-flex>
      </n-flex>
    </n-card>

    <div style="position: relative">
      <n-card :bordered="false" content-style="padding-top:0px">
        <n-flex>
          <div></div>
          <div>
            <n-tooltip trigger="hover" v-for="tag in tags" :key="tag.tagName">
              <template #trigger>
                <n-button style="margin: 5px" size="tiny" :type="tag.good ? 'primary' : 'error'">
                  {{ tag.tagName }}
                </n-button>
              </template>
              <span>{{ tag.tagDesc }}</span>
            </n-tooltip>
          </div>
        </n-flex>
      </n-card>
    </div>
    <!-- 宿敌和好友 -->
    <n-flex style="display: flex">
      <n-flex vertical style="flex: 1">
        <div
          v-if="recentData.friendAndDispute.friendsSummoner.length > 0"
          style="font-weight: 800; color: #8bdfb7"
        >
          <n-icon>
            <Accessibility />
          </n-icon>
          好友/胜率
        </div>
        <n-popover
          trigger="hover"
          v-for="friend in recentData.friendAndDispute.friendsSummoner"
          :key="friend.Summoner.puuid"
        >
          <template #trigger>
            <n-tag round :bordered="false" :color="{ textColor: winRateColor(friend.winRate) }">
              <n-ellipsis style="max-width: 150px">
                {{ friend?.Summoner?.gameName }}
              </n-ellipsis>

              <span style="font-size: 13px; margin-left: 5px">{{ friend.winRate }}</span>
              <template #avatar>
                <n-avatar :src="`${assetPrefix}/profile/${friend?.Summoner?.profileIconId}`" />
              </template>
            </n-tag>
          </template>
          <MettingPlayersCard :meet-games="friend.OneGamePlayer"></MettingPlayersCard>
        </n-popover>
      </n-flex>
      <n-flex vertical style="flex: 1">
        <div
          v-if="recentData.friendAndDispute.disputeSummoner.length > 0"
          style="font-weight: 800; color: #c9606f"
        >
          <n-icon>
            <Skull />
          </n-icon>
          宿敌/胜率
        </div>
        <n-popover
          trigger="hover"
          v-for="dispute in recentData.friendAndDispute.disputeSummoner"
          :key="dispute.Summoner.puuid"
        >
          <template #trigger>
            <n-tag round :bordered="false" :color="{ textColor: winRateColor(dispute.winRate) }">
              <n-ellipsis style="max-width: 150px">
                {{ dispute?.Summoner?.gameName }}
              </n-ellipsis>
              <span style="font-size: 13px; margin-left: 5px">{{ dispute.winRate }}</span>
              <template #avatar>
                <n-avatar :src="`${assetPrefix}/profile/${dispute?.Summoner?.profileIconId}`" />
              </template>
            </n-tag>
          </template>
          <MettingPlayersCard :meet-games="dispute.OneGamePlayer"></MettingPlayersCard>
        </n-popover>
      </n-flex>
    </n-flex>

    <div style="position: relative">
      <n-card :bordered="false">
        <div style="position: absolute; left: 0; top: 0">
          <span> 单双排 </span>
        </div>
        <n-flex>
          <div>
            <img
              width="70px"
              height="70px"
              :src="requireImg(rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase())"
            />
          </div>
          <div style="position: absolute; bottom: 10px; left: 25px">
            <span style="font-size: 12px">
              {{ rank.queueMap.RANKED_SOLO_5x5.tierCn }}
              {{ divisionOrPoint(rank.queueMap.RANKED_SOLO_5x5) }}
            </span>
          </div>
          <div style="width: 60%">
            <n-flex vertical>
              <RecordButton
                :record-type="
                  solo5v5RecentWinRate.winRate >= 58
                    ? 'good'
                    : solo5v5RecentWinRate.winRate <= 49
                      ? 'bad'
                      : ''
                "
              >
                胜率：{{ solo5v5RecentWinRate.winRate }}%
              </RecordButton>
              <n-button size="tiny">胜场：{{ solo5v5RecentWinRate.wins }}</n-button>
              <n-button size="tiny">负场：{{ solo5v5RecentWinRate.losses }}</n-button>
            </n-flex>
          </div>
        </n-flex>
      </n-card>
    </div>
    <div style="position: relative">
      <n-card :bordered="false">
        <n-flex>
          <div style="position: absolute; left: 0; top: 0">
            <span> 灵活组排 </span>
          </div>
          <div>
            <img
              width="70px"
              height="70px"
              :src="requireImg(rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase())"
            />
          </div>
          <div style="position: absolute; bottom: 10px; left: 25px">
            <span style="font-size: 12px">
              {{ rank.queueMap.RANKED_FLEX_SR.tierCn }}
              {{ divisionOrPoint(rank.queueMap.RANKED_FLEX_SR) }}
            </span>
          </div>
          <div style="width: 60%">
            <n-flex vertical>
              <RecordButton
                :record-type="
                  flexRecentWinRate.winRate >= 58
                    ? 'good'
                    : flexRecentWinRate.winRate <= 49
                      ? 'bad'
                      : ''
                "
              >
                胜率：{{ flexRecentWinRate.winRate }}%
              </RecordButton>
              <n-button size="tiny">胜场：{{ flexRecentWinRate.wins }}</n-button>
              <n-button size="tiny">负场：{{ flexRecentWinRate.losses }}</n-button>
            </n-flex>
          </div>
        </n-flex>
      </n-card>
    </div>
    <!-- 20场统计 -->
    <n-card class="recent-card" :bordered="false" content-style="padding:10px">
      <n-flex vertical style="position: relative">
        <n-flex>
          <div class="stats-title">最近表现</div>
          <div>
            <n-dropdown
              trigger="hover"
              :options="modeOptions"
              :on-select="updateModel"
              :show-arrow="false"
            >
              <n-button round size="tiny">{{ mode }}</n-button>
            </n-dropdown>
          </div>
        </n-flex>

        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label">
            <n-flex style="gap: 5px">
              <n-progress
                style="width: 12px; position: relative; bottom: 5px"
                type="circle"
                :show-indicator="false"
                :percentage="70"
                :height="24"
                status="success"
                color="bule"
              />

              <span>KDA:</span>
            </n-flex>
          </span>
          <span class="stats-value">
            <n-flex>
              <span :style="{ color: kdaColor(recentData.kda) }">{{ recentData.kda }}</span>
              <span>
                <span :style="{ color: killsColor(recentData.kills) }">
                  {{ recentData.kills }}
                </span>
                /
                <span :style="{ color: deathsColor(recentData.deaths) }">{{
                  recentData.deaths
                }}</span>
                /
                <span :style="{ color: assistsColor(recentData.assists) }">{{
                  recentData.assists
                }}</span>
              </span>
            </n-flex>
          </span>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"><n-icon> </n-icon> 胜率：</span>
          <n-flex>
            <span
              style="width: 65px"
              :style="{
                color: winRateColor(winRate(recentData.selectWins, recentData.selectLosses))
              }"
            >
              <n-progress
                type="line"
                :percentage="winRate(recentData.selectWins, recentData.selectLosses)"
                :height="6"
                :show-indicator="false"
                :color="winRateColor(winRate(recentData.selectWins, recentData.selectLosses))"
                processing
                :stroke-width="10"
                style="position: relative; top: 7px"
              ></n-progress>
            </span>
            <span
              class="stats-value"
              :style="{
                color: winRateColor(winRate(recentData.selectWins, recentData.selectLosses))
              }"
              >{{ winRate(recentData.selectWins, recentData.selectLosses) }}%</span
            >
          </n-flex>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"
            ><n-icon>
              <Accessibility></Accessibility>
            </n-icon>
            参团率：</span
          >
          <n-flex>
            <span style="width: 65px" :style="{ color: groupRateColor(recentData.groupRate) }">
              <n-progress
                type="line"
                :percentage="recentData.groupRate"
                :height="6"
                :show-indicator="false"
                :color="groupRateColor(recentData.groupRate)"
                processing
                :stroke-width="10"
                style="position: relative; top: 7px"
              ></n-progress>
            </span>
            <span class="stats-value" :style="{ color: groupRateColor(recentData.groupRate) }"
              >{{ recentData.groupRate }}%</span
            >
          </n-flex>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"> 伤害/占比：</span>
          <span class="stats-value">
            <n-flex>
              <span>
                {{ recentData.averageDamageDealtToChampions }}
              </span>
              <span style="width: 45px">
                <n-progress
                  type="line"
                  :percentage="recentData.damageDealtToChampionsRate"
                  :color="otherColor(recentData.damageDealtToChampionsRate)"
                  :height="6"
                  :show-indicator="false"
                  processing
                  :stroke-width="13"
                  style="position: relative; top: 7px"
                ></n-progress>
              </span>
              <span
                class="stats-value"
                :style="{ color: otherColor(recentData.damageDealtToChampionsRate) }"
              >
                {{ recentData.damageDealtToChampionsRate }}%
              </span>
            </n-flex>
          </span>
        </n-flex>
        <n-flex class="stats-item" justify="space-between">
          <span class="stats-label"> 经济/占比：</span>
          <n-flex>
            <span class="stats-value">{{ recentData.averageGold }} </span>

            <span style="width: 45px">
              <n-progress
                type="line"
                :percentage="recentData.goldRate"
                :height="6"
                :color="otherColor(recentData.goldRate)"
                :show-indicator="false"
                processing
                :stroke-width="13"
                style="position: relative; top: 7px"
              ></n-progress>
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
import { assetPrefix } from '../../services/http'
import { CopyOutline, Server, Accessibility, Skull } from '@vicons/ionicons5'
import { onMounted, ref } from 'vue'
import MettingPlayersCard from '../gaming/MettingPlayersCard.vue'
import { NCard, NFlex, NButton, NIcon, useMessage } from 'naive-ui'
import RecordButton from './RecordButton.vue'
import { useRoute } from 'vue-router'
import {
  defaultRank,
  defaultRecentData,
  defaultRecentWinRate,
  defaultSummoner,
  Rank,
  RankTag,
  RecentData,
  RecentWinRate,
  Summoner,
  UserTag
} from './type'
import {
  winRate,
  kdaColor,
  deathsColor,
  assistsColor,
  otherColor,
  groupRateColor,
  killsColor,
  winRateColor,
  modeOptions,
  initModeOptions
} from './composition'
import { divisionOrPoint } from '../composition'
import unranked from '../../assets/imgs/tier/unranked.png'
import bronze from '../../assets/imgs/tier/bronze.png'
import silver from '../../assets/imgs/tier/silver.png'
import gold from '../../assets/imgs/tier/gold.png'
import platinum from '../../assets/imgs/tier/platinum.png'
import diamond from '../../assets/imgs/tier/diamond.png'
import master from '../../assets/imgs/tier/master.png'
import grandmaster from '../../assets/imgs/tier/grandmaster.png'
import challenger from '../../assets/imgs/tier/challenger.png'
import iron from '../../assets/imgs/tier/iron.png'
import emerald from '../../assets/imgs/tier/emerald.png'
import { invoke } from '@tauri-apps/api/core'

const platformIdCn = ref('未知')
const summoner = ref<Summoner>(defaultSummoner())
const rank = ref<Rank>(defaultRank())
const solo5v5RecentWinRate = ref<RecentWinRate>(defaultRecentWinRate())
const flexRecentWinRate = ref<RecentWinRate>(defaultRecentWinRate())
const recentData = ref<RecentData>(defaultRecentData())

const route = useRoute()
let name = ''

onMounted(async () => {
  await initModeOptions()
  name = route.query.name as string
  summoner.value = await invoke<Summoner>('get_summoner_by_name', { name: name })
  rank.value = await invoke<Rank>('get_rank_by_name', { name })
  const modeValue = (await invoke<number>('get_config', { key: 'selectMode' })) || 0
  mode.value = modeOptions.value.find(option => option.key === modeValue)?.label || '全部'
  platformIdCn.value = await invoke('get_platform_name_by_name', { name })

  // 获取最近50场数据rank胜率
  solo5v5RecentWinRate.value = await invoke<RecentWinRate>('get_win_rate_by_name_mode', {
    name,
    mode: 420
  })
  flexRecentWinRate.value = await invoke<RecentWinRate>('get_win_rate_by_name_mode', {
    name,
    mode: 440
  })

  getTags(name, modeValue)
})

const mode = ref('全部')
const updateModel = (value: number, option: { label: string }) => {
  invoke('put_config', {
    key: 'settings.user.selectMode',
    value: value
  })
  getTags(name, value)
  mode.value = option.label
}
const tags = ref<RankTag[]>([])
const getTags = async (name: string, mode: number) => {
  const user_tag = await invoke<UserTag>('get_user_tag_by_name', {
    name,
    mode
  })
  tags.value = user_tag.tag
  recentData.value = user_tag.recentData
}
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
    emerald: emerald
  }

  const tierNormalized = tier ? tier.toLocaleLowerCase() : 'unranked'

  return tierImages[tierNormalized] || unranked
}

const message = useMessage()
const copy = () => {
  navigator.clipboard
    .writeText(summoner.value.gameName + '#' + summoner.value.tagLine)
    .then(() => {
      message.success('复制成功')
    })
    .catch(() => {
      message.error('复制失败')
    })
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
