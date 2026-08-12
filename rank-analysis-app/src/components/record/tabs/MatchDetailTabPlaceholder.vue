<template>
  <div class="match-detail-tab-placeholder">
    <span class="match-detail-tab-placeholder-icon">
      <n-icon :size="20"><component :is="icon" /></n-icon>
    </span>
    <div class="match-detail-tab-placeholder-title">{{ title }}</div>
    <div class="match-detail-tab-placeholder-desc">{{ desc }}</div>
    <n-tag v-if="lcudata" size="small" :bordered="false" type="info">LCU 数据源</n-tag>
    <n-tag v-else size="small" :bordered="false" type="warning">即将上线</n-tag>
  </div>
</template>

<script lang="ts" setup>
import { NIcon, NTag } from 'naive-ui'
import type { Component } from 'vue'

defineProps<{
  title: string
  desc: string
  icon: Component
  /** 非当前实现范围（LCU 暂无数据）时展示「即将上线」 */
  lcudata?: boolean
}>()
</script>

<style scoped>
.match-detail-tab-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-24) var(--space-12);
  color: var(--text-secondary);
  text-align: center;
}

.match-detail-tab-placeholder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: var(--glass-bg-low);
  color: var(--text-tertiary);
}

.match-detail-tab-placeholder-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-tab-placeholder-desc {
  font-size: var(--font-size-sm);
  max-width: 420px;
  line-height: 1.6;
}
</style>
