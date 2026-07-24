<template>
  <n-popover trigger="click">
    <template #trigger>
      <n-tooltip trigger="hover" :disabled="!tag.tagDesc">
        <template #trigger>
          <n-tag
            size="small"
            round
            :type="tag.good ? 'success' : 'error'"
            :bordered="false"
            class="unified-tag-chip"
          >
            {{ tag.tagName }}
          </n-tag>
        </template>
        <span>{{ tag.tagDesc }}</span>
      </n-tooltip>
    </template>
    <div class="solidify-pop">
      <div class="solidify-pop-text">把「{{ tag.tagName }}」存为对该玩家的备注？</div>
      <n-button size="tiny" type="primary" @click="emit('solidify', tag)">存为备注</n-button>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
/**
 * 单个系统标签 chip：hover 看 tagDesc，点击弹「存为备注」确认
 *
 * 从 UnifiedTagRow 抽出，供主行与 +N 溢出列表复用同一套交互。
 * 固化动作通过 emit 交回父级（store/message 逻辑留在 UnifiedTagRow）。
 */
import { NPopover, NTooltip, NTag, NButton } from 'naive-ui'
import type { RankTag } from '@renderer/types/domain/analysis'

/**
 * 组件属性
 * @property tag - 单个系统标签（tagName/tagDesc/good）
 */
defineProps<{ tag: RankTag }>()
const emit = defineEmits<{ solidify: [tag: RankTag] }>()
</script>

<style scoped>
.unified-tag-chip {
  cursor: pointer;
}

.solidify-pop {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-6, 6px);
}

.solidify-pop-text {
  font-size: var(--font-size-xs, 12px);
  color: var(--text-secondary);
}
</style>
