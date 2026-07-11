<template>
  <div class="asset-tooltip" :class="rarityClass">
    <div class="asset-tooltip-header">
      <img :src="iconSrc" :alt="name" class="asset-tooltip-icon" loading="lazy" decoding="async" />
      <div class="asset-tooltip-title-wrap">
        <div class="asset-tooltip-title">{{ name }}</div>
        <div v-if="rarityLabel" class="asset-tooltip-rarity" :class="rarityClass">
          {{ rarityLabel }}
        </div>
      </div>
    </div>
    <div
      v-if="sanitizedDescription"
      class="asset-tooltip-description"
      v-html="sanitizedDescription"
    ></div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{
  iconSrc: string
  name: string
  description: string
  /** LCU 返回的海克斯强化稀有度，如 kPrismatic / kGold / kSilver / kBronze */
  rarity?: string
}>()

const rarityMeta: Record<string, { label: string; cls: string }> = {
  kPrismatic: { label: '棱彩', cls: 'asset-tooltip-prismatic' },
  kGold: { label: '黄金', cls: 'asset-tooltip-gold' },
  kSilver: { label: '白银', cls: 'asset-tooltip-silver' },
  kBronze: { label: '青铜', cls: 'asset-tooltip-bronze' }
}

const rarityClass = computed(() => (props.rarity ? (rarityMeta[props.rarity]?.cls ?? '') : ''))
const rarityLabel = computed(() => (props.rarity ? (rarityMeta[props.rarity]?.label ?? '') : ''))

/**
 * 净化描述文本，只保留颜色相关的 HTML 标签
 * 英雄联盟的符文/物品描述使用 <font color="..."> 标签来显示颜色
 */
const sanitizedDescription = computed(() => {
  if (!props.description) return ''

  // 只保留 font 标签的 color 属性，其他标签都移除
  let sanitized = props.description
    // 保留 font 标签及其 color 属性
    .replace(/<font\s+color=["']([^"']*)["']\s*>/gi, '<span style="color:$1">')
    .replace(/<\/font>/gi, '</span>')
    // 移除其他所有 HTML 标签，但保留内容
    .replace(/<(?!\/?span\b)[^>]+>/gi, '')
    // 处理换行
    .replace(/\n/g, '<br>')

  return sanitized
})
</script>

<style scoped>
.asset-tooltip {
  max-width: 320px;
  padding: var(--space-2) 0;
  position: relative;
}

/* 海克斯稀有度：tooltip 左侧一条色带 + 标题色 */
.asset-tooltip.asset-tooltip-prismatic {
  --rarity-color: #bb7dff;
}

.asset-tooltip.asset-tooltip-gold {
  --rarity-color: #f4c658;
}

.asset-tooltip.asset-tooltip-silver {
  --rarity-color: #bfcde3;
}

.asset-tooltip.asset-tooltip-bronze {
  --rarity-color: #c58459;
}

.asset-tooltip[class*='asset-tooltip-']::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--rarity-color);
  border-radius: var(--radius-xs);
  box-shadow: 0 0 6px var(--rarity-color);
}

.asset-tooltip-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  margin-bottom: var(--space-6);
}

.asset-tooltip-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
}

.asset-tooltip[class*='asset-tooltip-'] .asset-tooltip-icon {
  border: 1px solid var(--rarity-color);
  box-shadow: 0 0 0 1px var(--border-subtle);
}

.asset-tooltip-title-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.asset-tooltip-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  line-height: var(--line-height-tight);
}

.asset-tooltip[class*='asset-tooltip-'] .asset-tooltip-title {
  color: var(--rarity-color);
}

.asset-tooltip-rarity {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--rarity-color);
  letter-spacing: 0.04em;
}

.asset-tooltip-description {
  white-space: normal;
  line-height: var(--line-height-normal);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.asset-tooltip-description :deep(span) {
  /* 允许行内颜色标签生效 */
}

.asset-tooltip-description :deep(br) {
  display: block;
  content: '';
  margin-bottom: var(--space-4);
}
</style>
