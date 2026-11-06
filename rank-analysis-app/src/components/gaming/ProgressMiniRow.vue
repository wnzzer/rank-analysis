<template>
  <div class="stats-row" :class="{ compact }" :aria-label="compact ? label : undefined">
    <span v-if="!compact" class="label">{{ label }}</span>
    <div class="progress-wrapper">
      <n-progress
        type="line"
        :percentage="percent"
        :height="6"
        :show-indicator="false"
        :color="color"
        :rail-color="compact ? 'var(--progress-rail)' : undefined"
        :processing="processing"
      />
      <span class="progress-text" :style="{ color }"
        >{{ precision === undefined ? percent : percent.toFixed(precision) }}%</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
/** 共用迷你进度行；紧凑模式用于窄列统计，默认保留原布局及处理动画。 */
import { NProgress } from 'naive-ui'

withDefaults(
  defineProps<{
    /** 统计名称；紧凑模式作为辅助阅读标签，不重复占用列宽。 */
    label: string
    /** 有效百分比，取值为 0..100；缺失值由调用方显示占位。 */
    percent: number
    /** 百分比文字及进度填充颜色，使用调用场景的主题 token。 */
    color: string
    /** 是否将数字与轨道纵向排列；默认 false，保留历史布局。 */
    compact?: boolean
    /** 是否播放持续处理动画；默认 true，静态统计可显式关闭。 */
    processing?: boolean
    /** 百分比显示小数位；省略时保留原始数字精度。 */
    precision?: number
  }>(),
  { compact: false, processing: true }
)
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

/* 窄表格列仍保留精确数字和完整轨道，规则只影响主动启用的紧凑实例。 */
.compact {
  min-width: 0;
}

.compact .progress-wrapper {
  flex-direction: column-reverse;
  align-items: stretch;
  gap: var(--space-4);
  margin-left: 0;
  min-width: 0;
}

.compact .progress-wrapper .n-progress {
  flex: none;
  width: 100%;
  max-width: none;
}

.compact .progress-text {
  min-width: 0;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
