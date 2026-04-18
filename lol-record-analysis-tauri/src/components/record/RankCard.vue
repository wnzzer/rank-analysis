<template>
  <n-card
    class="record-panel-card panel-glass"
    :bordered="false"
    size="small"
    content-style="padding: 10px"
  >
    <div class="rank-card-content">
      <div class="rank-icon-wrapper">
        <span class="rank-type-label">{{ label }}</span>
        <img :src="tierImage(queueInfo.tier)" class="rank-img" />
        <div class="rank-tier-text">{{ queueInfo.tierCn }} {{ divisionOrPoint(queueInfo) }}</div>
      </div>
      <div class="rank-stats">
        <div class="win-rate-badge" :class="badgeClass">胜率 {{ recent.winRate }}%</div>
        <n-flex justify="space-between" size="small" style="width: 100%; margin-top: 4px">
          <span class="rank-stat-text">胜场: {{ recent.wins }}</span>
          <span class="rank-stat-text">负场: {{ recent.losses }}</span>
        </n-flex>
      </div>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NFlex } from 'naive-ui'
import type { QueueInfo } from '@renderer/types/domain/player'
import type { RecentWinRate } from '@renderer/types/domain/player'
import { divisionOrPoint } from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'

const props = defineProps<{
  label: string
  queueInfo: QueueInfo
  recent: RecentWinRate
}>()

const badgeClass = computed(() => {
  if (props.recent.winRate >= 58) return 'good'
  if (props.recent.winRate <= 49) return 'bad'
  return 'normal'
})
</script>

<style scoped>
.panel-glass {
  background: transparent !important;
  border: 1px solid var(--border-subtle) !important;
  box-shadow: none !important;
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
  background: var(--glass-bg-low);
  border: 1px solid var(--glass-border);
}

.win-rate-badge.good {
  color: var(--semantic-win);
  background: rgba(61, 155, 122, 0.14);
  border-color: rgba(61, 155, 122, 0.22);
}

.win-rate-badge.bad {
  color: var(--semantic-loss);
  background: rgba(196, 92, 92, 0.1);
  border-color: rgba(196, 92, 92, 0.18);
}

.win-rate-badge.normal {
  color: var(--text-secondary);
}
</style>
