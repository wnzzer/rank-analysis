<template>
  <div class="user-side-panel">
    <!-- 跨区提示：段位/关系/近期数据不跨区，仅战绩可用 -->
    <div v-if="isCrossRegion" class="cross-region-note">
      跨区查询：仅提供该大区的对局战绩，段位 / 胜率 / 标签不支持跨区。
    </div>

    <template v-if="!isCrossRegion">
      <!-- ① 段位概览：两张 RankCard 合并进同一 Section（R4） -->
      <CornerCard v-model:collapsed="sec.rank" title="段位概览">
        <div class="rank-stack">
          <RankCard label="单双排" :queue-info="rank.queueMap.RANKED_SOLO_5x5" :recent="solo5v5" />
          <RankCard label="灵活组排" :queue-info="rank.queueMap.RANKED_FLEX_SR" :recent="flex" />
        </div>
      </CornerCard>

      <!-- ② 英雄池：近 50 场，hover 战绩卡联动高亮 -->
      <CornerCard
        v-if="championPool.length > 0"
        v-model:collapsed="sec.pool"
        title="英雄池"
        :subtitle="`近${championPool.length}场`"
      >
        <div class="hero-pool-list">
          <div
            v-for="entry in championPool"
            :key="entry.championId"
            class="hero-pool-row"
            :class="{
              'hero-pool-row-hovered': hoveredLocal === entry.championId,
              'hero-pool-row-dimmed': hoveredLocal !== null && hoveredLocal !== entry.championId,
              'hero-pool-row-active': activeChampion === entry.championId
            }"
            @mouseenter="hoveredLocal = entry.championId"
            @mouseleave="hoveredLocal = null"
            @click="onPoolClick(entry.championId)"
          >
            <img
              :src="`${assetPrefix}/champion/${entry.championId}`"
              class="hero-pool-champ-img"
              alt=""
            />
            <span class="hero-pool-name">{{ championName(entry.championId) }}</span>
            <span
              class="font-number hero-pool-winrate"
              :style="{ color: winRateColor(championWinRate(entry), isDark) }"
            >
              {{ championWinRate(entry) }}%
            </span>
            <span class="font-number hero-pool-count">{{ entry.count }}场</span>
          </div>
        </div>
      </CornerCard>

      <!-- ③ 近期统计 -->
      <CornerCard v-model:collapsed="sec.stats" title="近期统计">
        <RecentStatsTable
          :recent-data="recentData"
          :mode="mode"
          :is-dark="isDark"
          @mode-change="updateMode"
        />
      </CornerCard>

      <!-- ④ 好友 / 宿敌：双空时收成一行占位 -->
      <CornerCard v-model:collapsed="sec.relations" title="好友与宿敌">
        <n-flex v-if="hasRelations" :wrap="false" align="stretch" :size="12">
          <RelationshipPanel
            variant="friend"
            :summoners="recentData.friendAndDispute.friendsSummoner"
            :is-dark="isDark"
            @open-game="emit('open-game', $event)"
          />
          <RelationshipPanel
            variant="dispute"
            :summoners="recentData.friendAndDispute.disputeSummoner"
            :is-dark="isDark"
            @open-game="emit('open-game', $event)"
          />
        </n-flex>
        <div v-else class="relationship-empty-row">
          <span class="relationship-empty-label">
            <span class="relationship-empty-dot relationship-empty-dot-win"></span>好友
            <span class="relationship-empty-sep">/</span>
            <span class="relationship-empty-dot relationship-empty-dot-loss"></span>宿敌
          </span>
          <span class="relationship-empty-text">近 20 场没有重复同排的玩家</span>
        </div>
      </CornerCard>

      <!-- ⑤ 成长趋势：近 20 场趋势 + AI 成长报告 + 分时曲线 -->
      <CornerCard v-model:collapsed="sec.growth" title="成长趋势">
        <GrowthTrendCard
          :recent-data="recentData"
          :mode="mode"
          :is-dark="isDark"
          :games="games"
          :my-puuid="myPuuid"
        />
      </CornerCard>
    </template>
  </div>
</template>

<script lang="ts" setup>
/**
 * UserSidePanel —— 战绩左栏（设计系统 v3 §C3-R4）
 *
 * 五个区块统一 CornerCard 化，均可折叠且状态持久化到 localStorage；
 * 顺序调整为 段位概览 → 英雄池 → 近期统计 → 好友宿敌 → 成长趋势。
 * 对外 props/emits 与旧版完全一致，父级 Record.vue 无需感知重构。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { NFlex } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import CornerCard from '../ui/CornerCard.vue'
import { useSettingsStore } from '@renderer/features/settings/stores/setting'
import { assetPrefix } from '@renderer/services/http'
import { winRateColor } from '@renderer/utils/colors'
import type { Rank, RecentWinRate } from '@renderer/types/domain/player'
import type { RecentData } from '@renderer/types/domain/analysis'
import type { Game } from '@renderer/types/domain/match'
import type { championOption } from '@renderer/types/domain/champion'
import RelationshipPanel from './RelationshipPanel.vue'
import RankCard from './RankCard.vue'
import RecentStatsTable from './RecentStatsTable.vue'
import GrowthTrendCard from './GrowthTrendCard.vue'
import { championWinRate, type ChampionPoolEntry } from './championPool'

const props = defineProps<{
  rank: Rank
  solo5v5: RecentWinRate
  flex: RecentWinRate
  recentData: RecentData
  mode: string
  isCrossRegion: boolean
  championPool: ChampionPoolEntry[]
  hoveredChampion: number | null
  /** 近期对局全量（透传给趋势卡做 D-P3 分时曲线） */
  games: Game[]
  /** 本人 puuid（跨区为空时趋势卡用 games[0] 兜底） */
  myPuuid: string
  /** 当前战绩列表生效的英雄筛选（0 = 全部），用于英雄池行的选中态 */
  activeChampion?: number
}>()

const emit = defineEmits<{
  'mode-change': [value: string | number, option: { label?: string }]
  /** 英雄池行点击：上抛英雄 id，由战绩列表按该英雄筛选（再次点击同一英雄可取消） */
  'select-champion': [championId: number]
  /** 好友/宿敌弹窗内点击对局：上抛 gameId，由战绩列表定位并就地展开 */
  'open-game': [gameId: number]
}>()

/* ---------- 折叠状态（localStorage 记忆） ---------- */
type SectionKey = 'rank' | 'pool' | 'stats' | 'relations' | 'growth'
const COLLAPSE_KEY = 'ra.record.side.collapsed'

function loadCollapsed(): Partial<Record<SectionKey, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const sec = reactive<Record<SectionKey, boolean>>({
  rank: false,
  pool: false,
  stats: false,
  relations: false,
  growth: false,
  ...loadCollapsed()
})

watch(
  sec,
  value => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(value))
    } catch {
      /* 忽略 */
    }
  },
  { deep: true }
)

/* ---------- 原有业务逻辑 ---------- */

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

/** 好友/宿敌任一有数据才铺开双栏，双空时用单行占位 */
const hasRelations = computed(
  () =>
    (props.recentData.friendAndDispute?.friendsSummoner?.length ?? 0) > 0 ||
    (props.recentData.friendAndDispute?.disputeSummoner?.length ?? 0) > 0
)

const updateMode = (value: string | number, option: { label?: string }) => {
  emit('mode-change', value, option)
}

/** 英雄名映射：英雄池独立于战绩列表加载一次 */
const championOptions = ref<championOption[]>([])
onMounted(async () => {
  try {
    championOptions.value = await invoke<championOption[]>('get_champion_options')
  } catch {
    championOptions.value = []
  }
})

/** 本地高亮（英雄池自身 hover），并跟随战绩卡 hover 上抛的 prop */
const hoveredLocal = ref<number | null>(props.hoveredChampion)
watch(
  () => props.hoveredChampion,
  value => {
    hoveredLocal.value = value
  }
)

const championName = (id: number) =>
  championOptions.value.find(option => option.value === id)?.label ?? `英雄 ${id}`

/** 英雄池点击：上抛给战绩列表按该英雄筛选（切换/取消逻辑由列表侧处理） */
function onPoolClick(championId: number) {
  emit('select-champion', championId)
}
</script>

<style lang="css" scoped>
.user-side-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.cross-region-note {
  padding: var(--space-10) var(--space-12);
  border: 1px solid var(--warn-border);
  background: var(--warn-soft);
  clip-path: var(--clip-notch);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}

.rank-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

/* 好友/宿敌双空时的单行占位：虚线轻容器 */
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

/* === Hero Pool === */
.hero-pool-list {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: none;
}

.hero-pool-list::-webkit-scrollbar {
  display: none;
}

.hero-pool-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-expo),
    opacity var(--dur-fast) var(--ease-expo),
    transform var(--dur-fast) var(--ease-expo);
}

.hero-pool-row:hover {
  background: var(--glass-bg-mid);
  transform: translateX(2px);
}

.hero-pool-row-hovered {
  background: var(--glass-bg-mid);
  box-shadow: inset 2px 0 0 var(--accent-gold);
}

.hero-pool-row-active {
  background: var(--glass-bg-high);
  box-shadow: inset 2px 0 0 var(--accent-gold);
}

.hero-pool-row-dimmed {
  opacity: 0.45;
}

.hero-pool-champ-img {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.hero-pool-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hero-pool-winrate {
  font-size: var(--font-size-sm);
  font-weight: 700;
  white-space: nowrap;
}

.hero-pool-count {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
