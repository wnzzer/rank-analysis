<template>
  <div class="corner-card" :class="{ 'corner-card--emph': emphasis }">
    <div class="corner-card__in">
      <div
        v-if="title || $slots.extra"
        class="corner-card__head"
        :class="{ 'corner-card__head--clickable': collapsible }"
        @click="collapsible && $emit('update:collapsed', !collapsed)"
      >
        <span v-if="collapsible" class="corner-card__chev" :class="{ open: !collapsed }">▾</span>
        <h3 class="corner-card__title">{{ title }}</h3>
        <span v-if="subtitle" class="corner-card__sub">{{ subtitle }}</span>
        <span class="corner-card__extra" @click.stop><slot name="extra" /></span>
      </div>
      <div v-show="!collapsed" class="corner-card__body">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * CornerCard —— 设计系统 v3 万物容器（切角卡片基座）
 *
 * 视觉规范：design/spec/DESIGN-SPEC.md §7.1
 * - 外层承担投影（clip-path 会裁掉 box-shadow，故分离两层）
 * - 内层 clip-corner-md 切角 + 微噪点材质
 * - emphasis 变体：品牌描边 + 金色渐变头，仅用于"当前最重要的一块"
 * - collapsible：头部可点击折叠（v-model:collapsed），内容用 v-show 保活
 */
withDefaults(
  defineProps<{
    /** 卡片标题（可选，无标题时隐藏头部行） */
    title?: string
    /** 标题旁的弱化副题 */
    subtitle?: string
    /** 强调变体：品牌描边 + 渐变头 */
    emphasis?: boolean
    /** 开启头部点击折叠 */
    collapsible?: boolean
    /** 折叠态（配合 v-model:collapsed 使用） */
    collapsed?: boolean
  }>(),
  { title: '', subtitle: '', emphasis: false, collapsible: false, collapsed: false }
)

defineEmits<{ 'update:collapsed': [value: boolean] }>()
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
  background:
    linear-gradient(180deg, var(--brand-soft), transparent 42%),
    var(--bg-surface);
}
.corner-card__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-10);
  margin-bottom: var(--space-12);
}
.corner-card__head--clickable {
  cursor: pointer;
  user-select: none;
}
.corner-card__chev {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  transition: transform var(--dur-fast) var(--ease-expo);
}
.corner-card__chev.open {
  transform: rotate(0deg);
}
.corner-card__chev:not(.open) {
  transform: rotate(-90deg);
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
.corner-card__extra {
  margin-left: auto;
}
</style>

