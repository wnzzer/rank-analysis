<template>
  <div class="corner-card" :class="{ 'corner-card--emph': emphasis }">
    <div class="corner-card__in">
      <div v-if="title || $slots.extra" class="corner-card__head">
        <h3 class="corner-card__title">{{ title }}</h3>
        <span v-if="subtitle" class="corner-card__sub">{{ subtitle }}</span>
        <slot name="extra" />
      </div>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * CornerCard —— 设计系统 v3 万物容器（切角卡片基座）
 *
 * 视范规范：design/spec/DESIGN-SPEC.md §7.1
 * - 外层承担投影（clip-path 会裁掉 box-shadow，故分离两层）
 * - 内层 clip-corner-md 切角 + 微噪点材质
 * - emphasis 变体：品牌描边 + 金色渐变头，仅用于"当前最重要的一块"
 */
defineProps<{
  /** 卡片标题（可选，无标题时隐藏头部行） */
  title?: string
  /** 标题旁的弱化副题 */
  subtitle?: string
  /** 强调变体：品牌描边 + 渐变头 */
  emphasis?: boolean
}>()
</script>

<style scoped>
.corner-card {
  filter: drop-shadow(var(--shadow-1));
  transition: filter var(--dur-fast) var(--ease-expo);
}
.corner-card:hover {
  filter: drop-shadow(var(--shadow-2));
}
.corner-card__in {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  clip-path: var(--clip-corner-md);
  padding: var(--space-16);
}
/* 噪点材质：给暗面金属磨砂感；浅色主题减半 */
.corner-card__in::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--noise-img);
  opacity: 0.03;
  pointer-events: none;
  clip-path: inherit;
}
.theme-light .corner-card__in::after {
  opacity: 0.015;
}
.corner-card--emph .corner-card__in {
  border-color: var(--brand-border);
  background: linear-gradient(180deg, var(--brand-soft), transparent 42%), var(--bg-surface);
}
.corner-card__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-10);
  margin-bottom: var(--space-12);
}
.corner-card__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.corner-card__sub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
</style>
