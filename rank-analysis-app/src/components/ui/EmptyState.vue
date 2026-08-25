<template>
  <div class="empty">
    <span class="empty__icon" aria-hidden="true"><component :is="icon" /></span>
    <p class="empty__title">{{ title }}</p>
    <p v-if="description || $slots.default" class="empty__desc">
      <slot>{{ description }}</slot>
    </p>
    <div v-if="$slots.action" class="empty__act">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * EmptyState —— 标准空态（设计系统 v3 §7.7）
 * Lucide 图标 + 标题 + 说明 + 动作槽；禁止裸文案空态。
 */
import { markRaw, type Component } from 'vue'
import { CircleDashed } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    /** Lucide 图标组件 */
    icon?: Component
    /** 空态标题 */
    title: string
    /** 说明文字（可用默认 slot 覆盖） */
    description?: string
  }>(),
  { icon: markRaw(CircleDashed), description: '' }
)
</script>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-28) var(--space-20);
  text-align: center;
}
.empty__icon {
  display: inline-flex;
  color: var(--text-tertiary);
}
.empty__icon svg {
  width: 28px;
  height: 28px;
}
.empty__title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  color: var(--text-secondary);
}
.empty__desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  max-width: 360px;
}
.empty__act {
  margin-top: var(--space-4);
}
</style>
