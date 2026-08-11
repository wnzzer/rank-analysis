<template>
  <n-flex vertical class="user-side-panel" :size="12">
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
      <RankCard label="单双排" :queue-info="rank.queueMap.RANKED_SOLO_5x5" :recent="solo5v5" />
      <RankCard label="灵活组排" :queue-info="rank.queueMap.RANKED_FLEX_SR" :recent="flex" />
    </n-flex>

    <!-- Recent Stats -->
    <RecentStatsTable
      v-if="!isCrossRegion"
      :recent-data="recentData"
      :mode="mode"
      :is-dark="isDark"
      @mode-change="updateMode"
    />
  </n-flex>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { NCard, NFlex, NText } from 'naive-ui'
import { useSettingsStore } from '@renderer/pinia/setting'
import type { Rank, RecentWinRate } from '@renderer/types/domain/player'
import type { RecentData } from '@renderer/types/domain/analysis'
import RelationshipPanel from './RelationshipPanel.vue'
import RankCard from './RankCard.vue'
import RecentStatsTable from './RecentStatsTable.vue'

const props = defineProps<{
  rank: Rank
  solo5v5: RecentWinRate
  flex: RecentWinRate
  recentData: RecentData
  mode: string
  isCrossRegion: boolean
}>()

const emit = defineEmits<{
  'mode-change': [value: string | number, option: { label?: string }]
}>()

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

/** 好友/宿敌任一有数据才铺开双栏，双空时用单行占位（见模板注释） */
const hasRelations = computed(
  () =>
    (props.recentData.friendAndDispute?.friendsSummoner?.length ?? 0) > 0 ||
    (props.recentData.friendAndDispute?.disputeSummoner?.length ?? 0) > 0
)

const updateMode = (value: string | number, option: { label?: string }) => {
  emit('mode-change', value, option)
}
</script>

<style lang="css" scoped>
.user-side-panel {
  height: 100%;
}

.record-panel-card :deep(.n-card__content) {
  padding: var(--space-12);
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
