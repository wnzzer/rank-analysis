<template>
  <div class="stat-dots-row" :class="{ 'stat-dots-row-compact': props.compact }">
    <n-tooltip v-if="tooltip" trigger="hover" placement="top">
      <template #trigger>
        <div class="stat-dots-icon-wrap" :style="iconStyle">
          <n-icon v-if="icon" :size="iconSize">
            <component :is="icon" />
          </n-icon>
          <span v-else class="stat-dots-short-label">{{ shortLabel }}</span>
        </div>
      </template>
      {{ tooltip }}
    </n-tooltip>

    <div v-else class="stat-dots-icon-wrap" :style="iconStyle">
      <n-icon v-if="icon" :size="iconSize">
        <component :is="icon" />
      </n-icon>
      <span v-else class="stat-dots-short-label">{{ shortLabel }}</span>
    </div>

    <div class="stat-dots-track" :style="{ '--stat-dot-color': color }">
      <span
        v-for="i in 5"
        :key="i"
        class="stat-dot"
        :class="{ 'stat-dot-filled': i <= filledCount }"
      />
    </div>

    <div class="stat-dots-values">
      <span class="font-number stat-dots-value-main">{{ displayValue }}</span>
      <span class="font-number stat-dots-value-percent" :style="{ color }">{{ percent }}%</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, type Component, type CSSProperties } from 'vue'
import { dotFillCount } from './composition'

const props = withDefaults(
  defineProps<{
    icon?: Component
    tooltip?: string
    shortLabel?: string
    color: string
    value?: string | number
    percent: number
    iconBackground?: string
    iconSize?: number
    compact?: boolean
  }>(),
  {
    icon: undefined,
    tooltip: '',
    shortLabel: '',
    value: '--',
    iconBackground: 'rgba(0, 0, 0, 0.08)',
    iconSize: 11,
    compact: false
  }
)

const filledCount = computed(() => dotFillCount(props.percent))
const displayValue = computed(() => props.value)
const iconStyle = computed<CSSProperties>(() => ({
  background: props.iconBackground,
  color: props.color
}))
</script>

<style scoped>
.stat-dots-row {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.stat-dots-icon-wrap {
  width: 18px;
  height: 18px;
  border-radius: 5px; /* 18px 方块的视觉圆角,介于 xs(3) 和 sm(6) 之间 */
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-dots-short-label {
  font-size: 9px; /* 小标签字号,低于 --font-size-2xs(10),保留 */
  line-height: 1;
  font-weight: 700;
}

.stat-dots-track {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 3px; /* 5 颗 dot 之间的小间距,无对应 token */
}

.stat-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.theme-light .stat-dot {
  background: rgba(0, 0, 0, 0.24);
}

.stat-dot-filled {
  background: var(--stat-dot-color) !important;
}

.stat-dots-values {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
}

.stat-dots-value-main {
  width: 32px;
  text-align: right;
  color: var(--text-tertiary);
  font-weight: 500;
}

.stat-dots-value-percent {
  width: 34px;
  text-align: right;
  font-weight: 700;
}

.stat-dots-row-compact {
  gap: var(--space-4);
}

.stat-dots-row-compact .stat-dots-icon-wrap {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-xs);
}

.stat-dots-row-compact .stat-dots-track {
  gap: 2px; /* compact 模式 dot 间距,无对应 token */
}

.stat-dots-row-compact .stat-dot {
  width: 3px;
  height: 3px;
}

:deep(.n-progress-graph-line-fill) {
  transition: width var(--dur-slow) var(--ease-expo) !important;
}
</style>
