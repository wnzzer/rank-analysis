<template>
  <n-card class="record-card-skeleton" content-style="padding: 0 var(--space-12); height: 100%;">
    <n-flex align="center" justify="space-between" :wrap="false" style="height: 100%">
      <n-flex align="center" :size="12">
        <n-skeleton circle :width="32" :height="32" />
        <n-flex vertical :size="6">
          <n-skeleton :width="60" :height="12" />
          <n-skeleton :width="100" :height="10" />
        </n-flex>
      </n-flex>
      <n-skeleton :width="80" :height="20" />
      <n-skeleton :width="160" :height="28" />
    </n-flex>
  </n-card>
</template>

<script setup lang="ts">
import { NCard, NFlex, NSkeleton } from 'naive-ui'
</script>

<style scoped>
/* 与真实 RecordCard 行几何对齐：44px 高 / radius-md / 左缘色条占位，
   避免加载完成瞬间布局跳动 */
.record-card-skeleton {
  height: 44px;
  border-radius: var(--radius-md);
  margin-bottom: var(--space-8);
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--text-tertiary) 30%, transparent);
}

/* 减弱动效偏好：骨架脉冲静止，仅保留静态占位 */
@media (prefers-reduced-motion: reduce) {
  .record-card-skeleton :deep(.n-skeleton) {
    animation: none;
  }
}
</style>
