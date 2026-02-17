<template>
  <n-flex vertical class="user-record-container" :size="12">
    <!-- User Info Card -->
    <n-card class="record-panel-card" :bordered="false" size="small" content-style="padding: 12px">
      <n-flex align="center" :size="12">
        <div class="avatar-wrapper user-record-avatar">
          <n-avatar
            round
            :size="58"
            :src="`${assetPrefix}/profile/${summoner?.profileIconId}`"
            fallback-src="https://cube.elemecdn.com/3/7c/3ea6beec64369c2642b92c6726f1epng.png"
            class="user-record-avatar-img"
          />
          <div class="level-badge">
            {{ summoner.summonerLevel }}
          </div>
        </div>
        <n-flex vertical :size="2" style="flex: 1; min-width: 0">
          <n-flex align="center" :size="4" :wrap="false">
            <n-ellipsis style="max-width: 100%; font-weight: 700; font-size: 16px">
              {{ summoner.gameName }}
            </n-ellipsis>
            <n-button text size="tiny" @click="copy">
              <template #icon>
                <n-icon><copy-outline /></n-icon>
              </template>
            </n-button>
          </n-flex>
          <n-flex align="center" :size="6">
            <n-text depth="3" style="font-size: 12px">#{{ summoner.tagLine }}</n-text>
            <n-popover trigger="hover" v-if="serverDescription">
              <template #trigger>
                <n-tag
                  size="small"
                  :bordered="false"
                  type="default"
                  style="font-size: 10px; padding: 0 4px; height: 18px"
                >
                  {{ platformIdCn }}
                </n-tag>
              </template>
              <span>{{ serverDescription }}</span>
            </n-popover>
            <n-tag
              v-else
              size="small"
              :bordered="false"
              type="default"
              style="font-size: 10px; padding: 0 4px; height: 18px"
            >
              {{ platformIdCn }}
            </n-tag>
          </n-flex>
        </n-flex>
      </n-flex>

      <!-- Tags -->
      <n-flex v-if="tags.length > 0" style="margin-top: 12px" :size="6" wrap>
        <n-tooltip trigger="hover" v-for="tag in tags" :key="tag.tagName">
          <template #trigger>
            <n-tag size="small" :type="tag.good ? 'primary' : 'error'" :bordered="false" round>
              {{ tag.tagName }}
            </n-tag>
          </template>
          <span>{{ tag.tagDesc }}</span>
        </n-tooltip>
      </n-flex>
    </n-card>

    <!-- Friends & Rivals -->
    <n-flex :wrap="false" align="stretch" :size="12">
      <div class="relationship-col">
        <div class="section-header good-color">
          <n-icon><AccessibilityOutline /></n-icon>
          <span>好友/胜率</span>
        </div>
        <div class="relationship-list">
          <n-empty
            v-if="recentData.friendAndDispute.friendsSummoner.length === 0"
            description="暂无数据"
            size="small"
          ></n-empty>
          <n-popover
            trigger="hover"
            placement="right"
            v-for="friend in recentData.friendAndDispute.friendsSummoner"
            :key="friend.Summoner.puuid"
          >
            <template #trigger>
              <div class="relationship-item">
                <n-avatar
                  round
                  :size="24"
                  :src="`${assetPrefix}/profile/${friend?.Summoner?.profileIconId}`"
                />
                <n-ellipsis style="flex: 1; margin: 0 6px; font-size: 12px">{{
                  friend?.Summoner?.gameName
                }}</n-ellipsis>
                <span
                  :style="{
                    color: winRateColor(friend.winRate, isDark),
                    fontWeight: 'bold',
                    fontSize: '12px'
                  }"
                  >{{ friend.winRate }}</span
                >
              </div>
            </template>
            <MettingPlayersCard :meet-games="friend.OneGamePlayer"></MettingPlayersCard>
          </n-popover>
        </div>
      </div>

      <div class="relationship-col">
        <div class="section-header bad-color">
          <n-icon><FlashOutline /></n-icon>
          <span>宿敌/胜率</span>
        </div>
        <div class="relationship-list">
          <n-empty
            v-if="recentData.friendAndDispute.disputeSummoner.length === 0"
            description="暂无数据"
            size="small"
          ></n-empty>
          <n-popover
            trigger="hover"
            placement="right"
            v-for="dispute in recentData.friendAndDispute.disputeSummoner"
            :key="dispute.Summoner.puuid"
          >
            <template #trigger>
              <div class="relationship-item">
                <n-avatar
                  round
                  :size="24"
                  :src="`${assetPrefix}/profile/${dispute?.Summoner?.profileIconId}`"
                />
                <n-ellipsis style="flex: 1; margin: 0 6px; font-size: 12px">{{
                  dispute?.Summoner?.gameName
                }}</n-ellipsis>
                <span
                  :style="{
                    color: winRateColor(dispute.winRate, isDark),
                    fontWeight: 'bold',
                    fontSize: '12px'
                  }"
                  >{{ dispute.winRate }}</span
                >
              </div>
            </template>
            <MettingPlayersCard :meet-games="dispute.OneGamePlayer"></MettingPlayersCard>
          </n-popover>
        </div>
      </div>
    </n-flex>

    <!-- Rank Cards -->
    <n-flex vertical :size="12">
      <!-- Solo Rank -->
      <n-card
        class="record-panel-card"
        :bordered="false"
        size="small"
        content-style="padding: 10px"
      >
        <div class="rank-card-content">
          <div class="rank-icon-wrapper">
            <span class="rank-type-label">单双排</span>
            <img
              :src="requireImg(rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase())"
              class="rank-img"
            />
            <div class="rank-tier-text">
              {{ rank.queueMap.RANKED_SOLO_5x5.tierCn }}
              {{ divisionOrPoint(rank.queueMap.RANKED_SOLO_5x5) }}
            </div>
          </div>
          <div class="rank-stats">
            <div
              class="win-rate-badge"
              :class="
                solo5v5RecentWinRate.winRate >= 58
                  ? 'good'
                  : solo5v5RecentWinRate.winRate <= 49
                    ? 'bad'
                    : 'normal'
              "
            >
              胜率 {{ solo5v5RecentWinRate.winRate }}%
            </div>
            <n-flex justify="space-between" size="small" style="width: 100%; margin-top: 4px">
              <span class="rank-stat-text">胜场: {{ solo5v5RecentWinRate.wins }}</span>
              <span class="rank-stat-text">负场: {{ solo5v5RecentWinRate.losses }}</span>
            </n-flex>
          </div>
        </div>
      </n-card>

      <!-- Flex Rank -->
      <n-card
        class="record-panel-card"
        :bordered="false"
        size="small"
        content-style="padding: 10px"
      >
        <div class="rank-card-content">
          <div class="rank-icon-wrapper">
            <span class="rank-type-label">灵活组排</span>
            <img
              :src="requireImg(rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase())"
              class="rank-img"
            />
            <div class="rank-tier-text">
              {{ rank.queueMap.RANKED_FLEX_SR.tierCn }}
              {{ divisionOrPoint(rank.queueMap.RANKED_FLEX_SR) }}
            </div>
          </div>
          <div class="rank-stats">
            <div
              class="win-rate-badge"
              :class="
                flexRecentWinRate.winRate >= 58
                  ? 'good'
                  : flexRecentWinRate.winRate <= 49
                    ? 'bad'
                    : 'normal'
              "
            >
              胜率 {{ flexRecentWinRate.winRate }}%
            </div>
            <n-flex justify="space-between" size="small" style="width: 100%; margin-top: 4px">
              <span class="rank-stat-text">胜场: {{ flexRecentWinRate.wins }}</span>
              <span class="rank-stat-text">负场: {{ flexRecentWinRate.losses }}</span>
            </n-flex>
          </div>
        </div>
      </n-card>
    </n-flex>

    <!-- Recent Stats -->
    <n-card
      class="record-panel-card recent-stats-card"
      :bordered="false"
      size="small"
      content-style="padding: 12px"
    >
      <n-flex justify="space-between" align="center" class="recent-stats-header">
        <span class="recent-stats-title">最近表现</span>
        <n-dropdown
          trigger="hover"
          :options="modeOptions"
          :on-select="updateModel"
          :show-arrow="false"
        >
          <n-button round size="tiny" secondary type="primary">{{ mode }}</n-button>
        </n-dropdown>
      </n-flex>

      <n-flex vertical class="recent-stats-rows">
        <!-- KDA -->
        <div class="stat-row">
          <div class="stat-label-group">
            <n-icon class="stat-icon-kda"><PulseOutline /></n-icon>
            <span>KDA</span>
          </div>
          <div class="stat-value-group">
            <div class="raw-value spacer"></div>
            <div class="stat-center-content stat-kda-value-wrap">
              <span class="stat-kda-main" :style="{ color: kdaColor(recentData.kda, isDark) }">{{
                recentData.kda
              }}</span>
              <span class="kda-detail">
                <span :style="{ color: killsColor(recentData.kills, isDark) }">{{
                  recentData.kills
                }}</span>
                /
                <span :style="{ color: deathsColor(recentData.deaths, isDark) }">{{
                  recentData.deaths
                }}</span>
                /
                <span :style="{ color: assistsColor(recentData.assists, isDark) }">{{
                  recentData.assists
                }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Win Rate -->
        <div class="stat-row">
          <div class="stat-label-group">胜率</div>
          <div class="stat-value-group">
            <div class="raw-value spacer"></div>
            <div class="stat-center-content">
              <n-progress
                type="line"
                :percentage="winRate(recentData.selectWins, recentData.selectLosses)"
                :height="8"
                :show-indicator="false"
                :color="
                  winRateColor(winRate(recentData.selectWins, recentData.selectLosses), isDark)
                "
                rail-color="rgba(255, 255, 255, 0.1)"
              />
            </div>
            <span
              class="stat-value-text"
              :style="{
                color: winRateColor(winRate(recentData.selectWins, recentData.selectLosses), isDark)
              }"
            >
              {{ winRate(recentData.selectWins, recentData.selectLosses) }}%
            </span>
          </div>
        </div>

        <!-- Participation -->
        <div class="stat-row">
          <div class="stat-label-group">
            <n-icon><AccessibilityOutline /></n-icon> 参团率
          </div>
          <div class="stat-value-group">
            <div class="raw-value spacer"></div>
            <div class="stat-center-content">
              <n-progress
                type="line"
                :percentage="recentData.groupRate"
                :height="8"
                :show-indicator="false"
                :color="groupRateColor(recentData.groupRate, isDark)"
                rail-color="rgba(255, 255, 255, 0.1)"
              />
            </div>
            <span
              class="stat-value-text"
              :style="{ color: groupRateColor(recentData.groupRate, isDark) }"
            >
              {{ recentData.groupRate }}%
            </span>
          </div>
        </div>

        <!-- Damage -->
        <div class="stat-row">
          <div class="stat-label-group">伤害/占比</div>
          <div class="stat-value-group">
            <span class="raw-value">{{ recentData.averageDamageDealtToChampions }}</span>
            <div class="stat-center-content">
              <n-progress
                type="line"
                :percentage="recentData.damageDealtToChampionsRate"
                :color="otherColor(recentData.damageDealtToChampionsRate, isDark)"
                :height="8"
                :show-indicator="false"
                rail-color="rgba(255, 255, 255, 0.1)"
              />
            </div>
            <span
              class="stat-value-text"
              :style="{ color: otherColor(recentData.damageDealtToChampionsRate, isDark) }"
            >
              {{ recentData.damageDealtToChampionsRate }}%
            </span>
          </div>
        </div>

        <!-- Gold -->
        <div class="stat-row">
          <div class="stat-label-group">经济/占比</div>
          <div class="stat-value-group">
            <span class="raw-value">{{ recentData.averageGold }}</span>
            <div class="stat-center-content">
              <n-progress
                type="line"
                :percentage="recentData.goldRate"
                :color="otherColor(recentData.goldRate, isDark)"
                :height="8"
                :show-indicator="false"
                rail-color="rgba(255, 255, 255, 0.1)"
                style="width: 40px; margin: 0 4px"
              />
            </div>
            <span
              class="stat-value-text"
              :style="{ color: otherColor(recentData.goldRate, isDark) }"
            >
              {{ recentData.goldRate }}%
            </span>
          </div>
        </div>
      </n-flex>
    </n-card>
  </n-flex>
</template>

<script lang="ts" setup>
import { assetPrefix } from '../../services/http'
import { CopyOutline, AccessibilityOutline, FlashOutline, PulseOutline } from '@vicons/ionicons5'
import { onMounted, ref, computed } from 'vue'
import MettingPlayersCard from '../gaming/MettingPlayersCard.vue'
import {
  NCard,
  NFlex,
  NButton,
  NIcon,
  useMessage,
  NAvatar,
  NEllipsis,
  NText,
  NTag,
  NTooltip,
  NPopover,
  NEmpty,
  NProgress,
  NDropdown
} from 'naive-ui'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '../../pinia/setting'
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

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

const platformIdCn = ref('未知')

const serverDesc: Record<string, string> = {
  联盟一区: '联盟一区：祖安、皮尔特沃夫、巨神峰、教育网、男爵领域、均衡教派、影流、守望之海',
  联盟二区: '联盟二区：卡拉曼达、暗影岛、征服之海、诺克萨斯、战争学院、雷瑟守备',
  联盟三区: '联盟三区：班德尔城、裁决之地、水晶之痕、钢铁烈阳、皮城警备',
  联盟四区: '联盟四区：比尔吉沃特、弗雷尔卓德、扭曲丛林',
  联盟五区: '联盟五区：德玛西亚、无畏先锋、恕瑞玛、巨龙之巢'
}

const serverDescription = computed(() => {
  return serverDesc[platformIdCn.value]
})

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
const updateModel = (value: string | number, option: any) => {
  const selectMode = value as number
  invoke('put_config', {
    key: 'settings.user.selectMode',
    value: selectMode
  })
  getTags(name, selectMode)
  mode.value = option.label as string
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
.user-record-container {
  height: 100%;
}

.avatar-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: card-enter 0.4s var(--ease-out-expo) both;
}

.user-record-avatar {
  flex-shrink: 0;
}

.user-record-avatar :deep(.n-avatar) {
  background: transparent !important;
  border: 1px solid var(--border-subtle);
  box-shadow: none;
}

.user-record-avatar-img {
  object-fit: cover;
}

.level-badge {
  position: absolute;
  bottom: -6px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  padding: 0 6px;
  height: 16px;
  line-height: 14px;
  border-radius: var(--radius-lg);
  font-size: 10px;
  color: var(--text-secondary);
  z-index: 1;
  box-shadow: var(--shadow-card);
}

.relationship-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.section-header {
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 13px;
}

.section-header.good-color {
  color: var(--semantic-win);
}

.section-header.bad-color {
  color: var(--semantic-loss);
}

.relationship-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.relationship-item {
  display: flex;
  align-items: center;
  background-color: var(--bg-elevated);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.relationship-item:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

.rank-card-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rank-icon-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 70px;
}

.rank-type-label {
  font-size: 10px;
  color: var(--text-tertiary);
  position: absolute;
  top: -8px;
  left: 0;
}

.rank-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.rank-tier-text {
  font-size: 12px;
  font-weight: bold;
  text-align: center;
  line-height: 1.1;
  margin-top: -4px;
}

.rank-stats {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.rank-stat-text {
  font-size: 11px;
  color: var(--text-tertiary);
}

.win-rate-badge {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: bold;
  background-color: rgba(128, 128, 128, 0.1);
}

.win-rate-badge.good {
  color: var(--semantic-win);
  background-color: rgba(61, 155, 122, 0.2);
}

.win-rate-badge.bad {
  color: var(--semantic-loss);
  background-color: rgba(196, 92, 92, 0.2);
}

.win-rate-badge.normal {
  color: var(--text-secondary);
}

.recent-stats-header {
  margin-bottom: var(--space-12);
}

.recent-stats-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.recent-stats-rows {
  gap: var(--space-8);
}

.stat-row {
  display: flex;
  align-items: center;
  font-size: 13px;
  min-height: 28px;
}

.stat-label-group {
  width: 80px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  font-weight: 500;
  gap: 6px;
}

.stat-value-group {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

/* KDA 单行不换行，用 Inter 收窄宽度 */
.stat-kda-value-wrap {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.stat-kda-main {
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.02em;
}

.kda-detail {
  margin-left: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}

.stat-center-content {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 6px;
}

.stat-center-content :deep(.n-progress) {
  border-radius: 999px;
  overflow: hidden;
}

.stat-value-text {
  width: 38px;
  text-align: right;
  margin-left: 4px;
  flex-shrink: 0;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 13px;
}

.raw-value {
  width: 52px;
  text-align: right;
  margin-right: 8px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  font-size: 13px;
}

.stat-icon-kda {
  color: var(--semantic-win);
  font-size: 16px;
}
</style>
