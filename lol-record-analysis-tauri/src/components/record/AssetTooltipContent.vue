<template>
  <div class="asset-tooltip">
    <div class="asset-tooltip-header">
      <img :src="iconSrc" :alt="name" class="asset-tooltip-icon" loading="lazy" decoding="async" />
      <div class="asset-tooltip-title">{{ name }}</div>
    </div>
    <div class="asset-tooltip-description" v-html="sanitizedDescription"></div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{
  iconSrc: string
  name: string
  description: string
}>()

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
}

.asset-tooltip-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}

.asset-tooltip-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
}

.asset-tooltip-title {
  min-height: 24px;
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.asset-tooltip-description {
  white-space: normal;
  line-height: 1.45;
  font-size: 12px;
  color: var(--text-secondary);
}

.asset-tooltip-description :deep(span) {
  /* 允许行内颜色标签生效 */
}

.asset-tooltip-description :deep(br) {
  display: block;
  content: '';
  margin-bottom: 4px;
}
</style>
