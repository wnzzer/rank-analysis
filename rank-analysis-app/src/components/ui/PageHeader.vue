<template>
  <header class="ph">
    <div class="ph__main">
      <div v-if="kicker" class="kick">{{ kicker }}</div>
      <h1 class="ph__title">
        <slot name="title">{{ title }}</slot>
      </h1>
      <span v-if="subtitle || $slots.meta" class="ph__meta"
        ><slot name="meta">{{ subtitle }}</slot></span
      >
    </div>
    <div v-if="$slots.actions" class="ph__acts">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * PageHeader —— 统一页头（设计系统 v3 §7.4）
 *
 * 结构：kicker(可选金色眉题) + 标题 + meta 弱化行 + 右侧动作区。
 * 约定：主操作 ≤2 个（1 primary + 1 ghost），溢出进 ⋯ 菜单（由调用方裁剪）。
 */
defineProps<{
  /** 金色大写眉题，如 "GROWTH REPORT"；每屏至多一处 */
  kicker?: string
  /** 页标题 */
  title?: string
  /** 弱化副题（也可用 #meta slot 放富内容） */
  subtitle?: string
}>()
</script>

<style scoped>
.ph {
  display: flex;
  align-items: flex-end;
  gap: var(--space-16);
  flex-wrap: wrap;
  margin-bottom: var(--space-16);
}
.kick {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--brand);
  margin-bottom: var(--space-4);
}
.ph__main {
  min-width: 0;
}
.ph__title {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}
.ph__meta {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
.ph__acts {
  margin-left: auto;
  display: flex;
  gap: var(--space-8);
  align-items: center;
}
</style>
