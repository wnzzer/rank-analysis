<template>
  <div class="progress-stat-row">
    <div class="progress-stat-label-group">
      <slot name="label">{{ label }}</slot>
    </div>
    <div class="progress-stat-value-group">
      <span v-if="rawValue !== undefined" class="progress-stat-raw-value">{{ rawValue }}</span>
      <div v-else class="progress-stat-raw-value progress-stat-raw-value-spacer"></div>
      <div class="progress-stat-center">
        <n-progress
          type="line"
          :percentage="percent"
          :color="color"
          :height="8"
          :show-indicator="false"
          rail-color="rgba(255, 255, 255, 0.1)"
        />
      </div>
      <span class="progress-stat-value-text" :style="{ color }">{{ percent }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NProgress } from 'naive-ui'

defineProps<{
  label?: string
  rawValue?: number | string
  percent: number
  color: string
}>()
</script>

<style scoped>
.progress-stat-row {
  display: flex;
  align-items: center;
  font-size: var(--font-size-base);
  min-height: 28px; /* 行高:与 RecentStatsTable 同步 */
}

.progress-stat-label-group {
  /* 74px 容下"图标+三字标签"（如 参团率）在大屏放大字号下不换行；
     与 RecentStatsTable 同步 */
  width: 74px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  font-weight: 500;
  gap: var(--space-6);
  white-space: nowrap;
}

.progress-stat-value-group {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

.progress-stat-center {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 var(--space-6);
}

.progress-stat-center :deep(.n-progress) {
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.progress-stat-value-text {
  width: 38px;
  text-align: right;
  margin-left: var(--space-4);
  flex-shrink: 0;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: var(--font-size-base);
}

.progress-stat-raw-value {
  width: 52px;
  text-align: right;
  margin-right: var(--space-8);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  font-size: var(--font-size-base);
}

.progress-stat-raw-value-spacer {
  visibility: hidden;
}
</style>
