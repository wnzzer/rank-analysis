<template>
  <n-flex vertical class="user-record-container" :size="12">
    <!-- User Info Card -->
    <n-card
      class="record-panel-card panel-glass"
      :bordered="false"
      size="small"
      content-style="padding: 12px"
    >
      <n-flex align="center" :size="12">
        <div class="avatar-wrapper user-record-avatar">
          <n-avatar
            round
            :size="58"
            :src="`${assetPrefix}/profile/${summoner?.profileIconId}`"
            fallback-src="https://cube.elemecdn.com/3/7c/3ea6beec64369c2642b92c6726f1epng.png"
            class="user-record-avatar-img"
          />
          <div class="level-badge">{{ summoner.summonerLevel }}</div>
        </div>
        <n-flex vertical :size="2" style="flex: 1; min-width: 0">
          <n-flex align="center" :size="4" :wrap="false">
            <n-ellipsis style="max-width: 100%; font-weight: 700; font-size: 16px">
              {{ summoner.gameName }}
            </n-ellipsis>
            <n-button text size="tiny" @click="copyName">
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
      <RelationshipPanel
        variant="friend"
        :summoners="recentData.friendAndDispute.friendsSummoner"
        :is-dark="isDark"
      />
      <RelationshipPanel
        variant="dispute"
        :summoners="recentData.friendAndDispute.disputeSummoner"
        :is-dark="isDark"
      />
    </n-flex>

    <!-- Rank Cards -->
    <n-flex vertical :size="12">
      <RankCard
        label="单双排"
        :queue-info="rank.queueMap.RANKED_SOLO_5x5"
        :recent="solo5v5RecentWinRate"
      />
      <RankCard
        label="灵活组排"
        :queue-info="rank.queueMap.RANKED_FLEX_SR"
        :recent="flexRecentWinRate"
      />
    </n-flex>

    <!-- Recent Stats -->
    <RecentStatsTable
      :recent-data="recentData"
      :mode="mode"
      :is-dark="isDark"
      @mode-change="updateModel"
    />
  </n-flex>
</template>

<script lang="ts" setup>
import { assetPrefix } from '@renderer/services/http'
import { CopyOutline } from '@vicons/ionicons5'
import { onMounted, ref, computed, watch } from 'vue'
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
  NPopover
} from 'naive-ui'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@renderer/pinia/setting'
import {
  defaultRank,
  defaultRecentWinRate,
  defaultSummoner,
  type Rank,
  type RecentWinRate,
  type Summoner
} from '@renderer/types/domain/player'
import {
  defaultRecentData,
  type RankTag,
  type RecentData,
  type UserTag
} from '@renderer/types/domain/analysis'
import { modeOptions, initModeOptions } from '@renderer/composables/useGameModes'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import RelationshipPanel from './RelationshipPanel.vue'
import RankCard from './RankCard.vue'
import RecentStatsTable from './RecentStatsTable.vue'

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

const serverDescription = computed(() => serverDesc[platformIdCn.value])

const summoner = ref<Summoner>(defaultSummoner())
const rank = ref<Rank>(defaultRank())
const solo5v5RecentWinRate = ref<RecentWinRate>(defaultRecentWinRate())
const flexRecentWinRate = ref<RecentWinRate>(defaultRecentWinRate())
const recentData = ref<RecentData>(defaultRecentData())

const route = useRoute()
let name = ''

const loadSummonerData = async (summonerName: string) => {
  if (!summonerName) return

  name = summonerName

  // 需要 summoner 作为其余请求的依据，单独先取；其余调用互相独立，并行
  summoner.value = await invoke<Summoner>('get_summoner_by_name', { name })

  const [rankValue, modeValue, platformValue, solo, flex] = await Promise.all([
    invoke<Rank>('get_rank_by_name', { name }),
    // 历史上 reader 用 `selectMode`、writer 用 `settings.user.selectMode`，
    // 导致用户切换的模式从来没被持久化读到。统一为 writer 用的 key。
    getConfigByIpc<number>('settings.user.selectMode').then(v => v ?? 0),
    invoke<string>('get_platform_name_by_name', { name }),
    invoke<RecentWinRate>('get_win_rate_by_name_mode', { name, mode: 420 }),
    invoke<RecentWinRate>('get_win_rate_by_name_mode', { name, mode: 440 })
  ])

  rank.value = rankValue
  mode.value = modeOptions.value.find(option => option.key === modeValue)?.label || '全部'
  platformIdCn.value = platformValue
  solo5v5RecentWinRate.value = solo
  flexRecentWinRate.value = flex

  getTags(name, modeValue)
}

onMounted(async () => {
  await initModeOptions()
  const nameFromQuery = route.query.name as string
  if (nameFromQuery) {
    await loadSummonerData(nameFromQuery)
  }
})

watch(
  () => route.query.name,
  newName => {
    if (newName && typeof newName === 'string') {
      loadSummonerData(newName)
    }
  }
)

const mode = ref('全部')
const updateModel = (value: string | number, option: any) => {
  const selectMode = value as number
  putConfigByIpc('settings.user.selectMode', selectMode)
  getTags(name, selectMode)
  mode.value = option.label as string
}

const tags = ref<RankTag[]>([])
const getTags = async (name: string, mode: number) => {
  const user_tag = await invoke<UserTag>('get_user_tag_by_name', { name, mode })
  tags.value = user_tag.tag
  recentData.value = user_tag.recentData
}

const message = useMessage()
const copyName = () => {
  navigator.clipboard
    .writeText(summoner.value.gameName + '#' + summoner.value.tagLine)
    .then(() => message.success('复制成功'))
    .catch(() => message.error('复制失败'))
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

.panel-glass {
  background: transparent !important;
  border: 1px solid var(--border-subtle) !important;
  box-shadow: none !important;
}
</style>
