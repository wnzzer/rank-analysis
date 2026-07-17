<template>
  <n-card
    class="rank-card record-panel-card panel-glass"
    :bordered="false"
    size="small"
    :content-style="cardContentStyle"
  >
    <div class="rank-card-content">
      <div class="rank-card-icon-wrapper">
        <span class="rank-card-type-label">{{ label }}</span>
        <img :src="tierImage(queueInfo.tier)" class="rank-card-img" />
        <div class="rank-card-tier-text">
          {{ formatTierText(queueInfo) }}
        </div>
      </div>
      <div class="rank-card-stats">
        <div class="rank-card-win-badge" :class="badgeClass">
          {{ hasGames ? `胜率 ${recent.winRate}%` : '暂无对局' }}
        </div>
        <n-flex justify="space-between" size="small" class="rank-card-stats-row">
          <span class="rank-card-stat-text">胜场: {{ recent.wins }}</span>
          <span class="rank-card-stat-text">负场: {{ recent.losses }}</span>
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
import { formatTierText } from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'

const props = defineProps<{
  label: string
  queueInfo: QueueInfo
  recent: RecentWinRate
}>()

/** 0 胜 0 负说明该队列没打过，红色「胜率 0%」会被误读成连败 */
const hasGames = computed(() => props.recent.wins + props.recent.losses > 0)

const badgeClass = computed(() => {
  if (!hasGames.value) return 'normal'
  if (props.recent.winRate >= 58) return 'good'
  if (props.recent.winRate <= 49) return 'bad'
  return 'normal'
})

// n-card 的 content-style 需要字符串/对象,这里用 token 占位以避免 inline 字面量
const cardContentStyle = 'padding: var(--space-10)'
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
  gap: var(--space-12);
}

.rank-card-icon-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 70px;
}

.rank-card-type-label {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  position: absolute;
  top: calc(var(--space-8) * -1);
  left: 0;
}

.rank-card-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.rank-card-tier-text {
  font-size: var(--font-size-sm);
  white-space: nowrap;
  font-weight: bold;
  text-align: center;
  line-height: var(--line-height-tight);
  margin-top: calc(var(--space-4) * -1);
}

.rank-card-stats {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.rank-card-stats-row {
  width: 100%;
  margin-top: var(--space-4);
}

.rank-card-stat-text {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.rank-card-win-badge {
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: bold;
  background: var(--glass-bg-low);
  border: 1px solid var(--glass-border);
}

.rank-card-win-badge.good {
  color: var(--semantic-win);
  background: color-mix(in srgb, var(--semantic-win) 14%, transparent);
  border-color: color-mix(in srgb, var(--semantic-win) 22%, transparent);
}

.rank-card-win-badge.bad {
  color: var(--semantic-loss);
  background: color-mix(in srgb, var(--semantic-loss) 10%, transparent);
  border-color: color-mix(in srgb, var(--semantic-loss) 18%, transparent);
}

.rank-card-win-badge.normal {
  color: var(--text-secondary);
}
</style>
