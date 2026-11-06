<script setup lang="ts">
/** 固定尺寸英雄头像；失败时显示名字首字，避免破图和反复重试。 */
import { ref, watch } from 'vue'
const props = withDefaults(
  defineProps<{
    /** 由项目资源服务提供的图片地址。 */
    src: string
    /** 英雄中文名，用于无障碍说明和失败占位。 */
    name: string
    /** 头像边长，像素。 */
    size?: number
  }>(),
  { size: 32 }
)
const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  }
)
</script>
<template>
  <span class="matchup-avatar" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="!failed && src" :src="src" :alt="name" @error="failed = true" />
    <span v-else role="img" :aria-label="name">{{ name.slice(0, 1) }}</span>
  </span>
</template>
<style scoped>
.matchup-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-secondary);
}
.matchup-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
