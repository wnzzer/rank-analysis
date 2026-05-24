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
  font-size: var(--font-size-sm);
}

.label {
  color: var(--n-text-color-3);
}

.progress-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex: 1;
  justify-content: flex-end;
  margin-left: var(--space-8);
}

.progress-wrapper .n-progress {
  flex: 1;
  max-width: 120px;
}

.progress-text {
  font-size: var(--font-size-xs);
  min-width: 35px;
  text-align: right;
}
</style>
