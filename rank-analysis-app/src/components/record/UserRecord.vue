<template>
  <n-flex vertical class="user-record-container" :size="12">
    <!-- User Info Card -->
    <n-card class="record-panel-card panel-glass user-record-card" :bordered="false" size="small">
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
        <n-flex vertical :size="2" class="user-record-identity">
          <n-flex align="center" :size="4" :wrap="false">
            <n-ellipsis class="user-record-nickname">
              {{ summoner.gameName }}
            </n-ellipsis>
            <n-button text size="tiny" @click="copyName">
              <template #icon>
                <n-icon><copy-outline /></n-icon>
              </template>
            </n-button>
            <PlayerNoteBadge
              v-if="summoner.puuid"
              :puuid="summoner.puuid"
              :game-name="summoner.gameName"
              :tag-line="summoner.tagLine"
              size="normal"
            />
          </n-flex>
          <n-flex align="center" :size="6">
            <n-text depth="3" class="user-record-tagline">#{{ summoner.tagLine }}</n-text>
            <n-popover trigger="hover" v-if="serverDescription">
              <template #trigger>
                <n-tag
                  size="small"
                  :bordered="false"
                  type="default"
                  class="user-record-platform-tag"
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
              class="user-record-platform-tag"
            >
              {{ platformIdCn }}
            </n-tag>
          </n-flex>
        </n-flex>
      </n-flex>

      <!-- Tags：系统标签 + 备注 chip 统一行（备注为空且无标签时整行隐藏，避免空 margin） -->
      <UnifiedTagRow
        v-if="tags.length > 0 || hasNote"
        class="user-record-tags"
        :tags="tags"
        :puuid="summoner.puuid"
        :game-name="summoner.gameName"
        :tag-line="summoner.tagLine"
      />
    </n-card>

    <!-- 跨区提示：段位/关系/近期数据不跨区，仅战绩可用 -->
    <n-card
      v-if="isCrossRegion"
      class="record-panel-card panel-glass"
      :bordered="false"
      size="small"
    >
      <n-text depth="3" style="font-size: var(--font-size-sm); line-height: 1.6">
        跨区查询：仅提供该大区的对局战绩，段位 / 胜率 / 标签不支持跨区。
      </n-text>
    </n-card>

    <!-- Friends & Rivals：双空时收成一行，不让两块空态占据侧栏黄金位置 -->
    <n-flex v-if="!isCrossRegion && hasRelations" :wrap="false" align="stretch" :size="12">
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
    <div v-else-if="!isCrossRegion" class="relationship-empty-row">
      <span class="relationship-empty-label">
        <span class="relationship-empty-dot relationship-empty-dot-win"></span>好友
        <span class="relationship-empty-sep">/</span>
        <span class="relationship-empty-dot relationship-empty-dot-loss"></span>宿敌
      </span>
      <span class="relationship-empty-text">近 20 场没有重复同排的玩家</span>
    </div>

    <!-- Rank Cards -->
    <n-flex v-if="!isCrossRegion" vertical :size="12">
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
      v-if="!isCrossRegion"
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
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import UnifiedTagRow from '@renderer/components/common/UnifiedTagRow.vue'
import { usePlayerNotesStore } from '@renderer/pinia/playerNotes'

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

/** 好友/宿敌任一有数据才铺开双栏，双空时用单行占位（见模板注释） */
const hasRelations = computed(
  () =>
    (recentData.value.friendAndDispute?.friendsSummoner?.length ?? 0) > 0 ||
    (recentData.value.friendAndDispute?.disputeSummoner?.length ?? 0) > 0
)

const route = useRoute()
/** 跨区查询目标大区 platformId（空 = 当前区，走本地 LCU） */
const region = computed(() => (route.query.region as string) ?? '')
const isCrossRegion = computed(() => !!region.value)
let name = ''

const loadSummonerData = async (summonerName: string) => {
  if (!summonerName) return

  name = summonerName

  // 跨区：段位/胜率/标签不支持跨区，只展示玩家名与大区，其余置默认。
  // 对局战绩由右侧 MatchHistory 走 SGP，不在此处加载。
  if (region.value) {
    const [g, t] = summonerName.split('#')
    summoner.value = { ...defaultSummoner(), gameName: g ?? summonerName, tagLine: t ?? '' }
    rank.value = defaultRank()
    solo5v5RecentWinRate.value = defaultRecentWinRate()
    flexRecentWinRate.value = defaultRecentWinRate()
    recentData.value = defaultRecentData()
    tags.value = []
    try {
      const regions = await invoke<{ label: string; value: string }[]>('get_sgp_regions')
      platformIdCn.value = regions.find(r => r.value === region.value)?.label ?? region.value
    } catch {
      platformIdCn.value = region.value
    }
    return
  }

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

const notesStore = usePlayerNotesStore()
/** 当前玩家是否已有手动备注（决定标签行在无系统标签时是否仍展示备注 chip） */
const hasNote = computed(() => !!summoner.value.puuid && !!notesStore.getNote(summoner.value.puuid))

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

.user-record-card :deep(.n-card__content) {
  padding: var(--space-12);
}

.user-record-identity {
  flex: 1;
  min-width: 0;
}

/* :deep 因 n-ellipsis 子组件根 scoped attr 不透传 (同 Gaming/PlayerCard 教训) */
/* 16→20px 随 viewport (1100→2200) */
:deep(.user-record-nickname) {
  max-width: 100%;
  font-size: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  font-weight: 700;
}

.user-record-tagline {
  font-size: var(--font-size-sm);
}

.user-record-platform-tag {
  font-size: var(--font-size-2xs);
  padding: 0 var(--space-4);
  height: 18px;
}

.user-record-tags {
  margin-top: var(--space-12);
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
  /* 58→76px 随 viewport 平滑放大 (1100→2200), 强制覆盖 n-avatar inline size="58" */
  width: clamp(58px, calc(58px + (100vw - 1100px) * 18 / 1100), 76px) !important;
  height: clamp(58px, calc(58px + (100vw - 1100px) * 18 / 1100), 76px) !important;
}

.user-record-avatar-img {
  object-fit: cover;
}

.level-badge {
  position: absolute;
  bottom: calc(-1 * var(--space-6));
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  padding: 0 var(--space-6);
  height: 16px;
  line-height: 14px;
  border-radius: var(--radius-lg);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  z-index: 1;
  box-shadow: var(--shadow-card);
}

.panel-glass {
  background: transparent !important;
  border: 1px solid var(--border-subtle) !important;
  box-shadow: none !important;
}

/* 好友/宿敌双空时的单行占位：虚线轻容器，明示「没有」而不是占两块空面板 */
.relationship-empty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-10);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
  font-size: var(--font-size-sm);
}

.relationship-empty-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  white-space: nowrap;
}

.relationship-empty-sep {
  color: var(--text-tertiary);
}

.relationship-empty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.relationship-empty-dot-win {
  background: var(--semantic-win);
  opacity: 0.6;
}

.relationship-empty-dot-loss {
  background: var(--semantic-loss);
  opacity: 0.6;
}

.relationship-empty-text {
  color: var(--text-tertiary);
}
</style>
