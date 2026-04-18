<template>
  <div class="stats-row">
    <span class="label">{{ label }}</span>
    <div class="progress-wrapper">
      <n-progress
        type="line"
        :percentage="percent"
        :height="6"
        :show-indicator="false"
        :color="color"
        processing
      />
      <span class="progress-text" :style="{ color }">{{ percent }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NProgress } from 'naive-ui'

defineProps<{
  label: string
  percent: number
  color: string
}>()
</script>

<style scoped>
.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.label {
  color: var(--n-text-color-3);
}

.progress-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: flex-end;
  margin-left: 8px;
}

.progress-wrapper .n-progress {
  flex: 1;
  max-width: 120px;
}

.progress-text {
  font-size: 11px;
  min-width: 35px;
  text-align: right;
}
</style>
