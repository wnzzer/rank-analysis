<template>
  <n-button ghost :type="buttonType" size="tiny">
    <slot></slot>
    <template v-if="recordType === 'good'">
      <n-icon class="record-button-icon">
        <ArrowUp />
      </n-icon>
    </template>
    <template v-else-if="recordType === 'bad'">
      <n-icon class="record-button-icon">
        <ArrowDown />
      </n-icon>
    </template>
  </n-button>
</template>

<script lang="ts" setup>
/**
 * 战绩标签按钮
 *
 * 用语义化颜色（success / error）展示玩家近期的好坏倾向，
 * 右侧通过箭头图标二次强调方向。
 */
import { computed } from 'vue'
import { ArrowDown, ArrowUp } from '@vicons/ionicons5'

const props = defineProps<{
  /** 倾向类型：good 上升 / bad 下降 / 空字符串无标记 */
  recordType?: 'good' | 'bad' | ''
}>()

/** 根据 recordType 映射到 naive-ui 的 button 语义类型 */
const buttonType = computed(() => {
  if (props.recordType === 'good') {
    return 'success'
  } else if (props.recordType === 'bad') {
    return 'error'
  } else {
    return ''
  }
})
</script>

<style scoped>
.record-button-icon {
  margin-left: var(--space-4);
}
</style>
