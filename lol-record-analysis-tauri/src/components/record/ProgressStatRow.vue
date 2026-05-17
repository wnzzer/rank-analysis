<template>
  <div class="stat-row">
    <div class="stat-label-group">
      <slot name="label">{{ label }}</slot>
    </div>
    <div class="stat-value-group">
      <span v-if="rawValue !== undefined" class="raw-value">{{ rawValue }}</span>
      <div v-else class="raw-value spacer"></div>
      <div class="stat-center-content">
        <n-progress
          type="line"
          :percentage="percent"
          :color="color"
          :height="8"
          :show-indicator="false"
          rail-color="rgba(255, 255, 255, 0.1)"
        />
      </div>
      <span class="stat-value-text" :style="{ color }">{{ percent }}%</span>
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
.stat-row {
  display: flex;
  align-items: center;
  font-size: 13px;
  min-height: 28px;
}

.stat-label-group {
  /* 与 RecentStatsTable 同步收紧 */
  width: 60px;
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

.raw-value.spacer {
  visibility: hidden;
}
</style>
