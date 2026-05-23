<template>
  <span
    class="lazy-img"
    :class="{
      'lazy-img-loading': state === 'loading',
      'lazy-img-error': state === 'error'
    }"
  >
    <img :src="src" :alt="alt" loading="lazy" @load="onLoad" @error="onError" />
  </span>
</template>

<script setup lang="ts">
/**
 * 懒加载图片组件
 *
 * 在图片加载完成前显示 shimmer 占位动画，加载失败时降低透明度作为错误回退。
 *
 * @example
 * ```vue
 * <LazyImg src="/champion/1.png" alt="champion" />
 * ```
 */
import { ref } from 'vue'

defineProps<{
  /** 图片地址 */
  src: string
  /** 替代文本 */
  alt?: string
}>()

const state = ref<'loading' | 'loaded' | 'error'>('loading')

function onLoad() {
  state.value = 'loaded'
}

function onError() {
  state.value = 'error'
}
</script>

<style scoped>
.lazy-img {
  display: inline-block;
  position: relative;
  line-height: 0;
}
.lazy-img img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity var(--dur-fast) var(--ease-expo);
}
.lazy-img-loading img {
  opacity: 0;
}
.lazy-img-loading::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 0%,
    var(--glass-bg-mid) 50%,
    var(--bg-elevated) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
  border-radius: inherit;
}
.lazy-img-error img {
  opacity: 0.3;
}
</style>
