<template>
  <span
    class="lazy-img"
    :class="{
      'lazy-img-loading': state === 'loading',
      'lazy-img-error': state === 'error'
    }"
  >
    <img :src="currentSrc" :alt="alt" loading="lazy" @load="onLoad" @error="onError" />
  </span>
</template>

<script setup lang="ts">
/**
 * 懒加载图片组件
 *
 * 在图片加载完成前显示 shimmer 占位动画，加载失败时降低透明度作为错误回退，
 * 并按 {@link LAZY_IMG_RETRY_DELAYS_MS} 延时重试（后端资源列表就绪后自动补图）。
 *
 * @example
 * ```vue
 * <LazyImg src="/champion/1.png" alt="champion" />
 * ```
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LAZY_IMG_RETRY_DELAYS_MS, withRetryParam } from './lazyImgRetry'

const props = defineProps<{
  /** 图片地址 */
  src: string
  /** 替代文本 */
  alt?: string
}>()

const state = ref<'loading' | 'loaded' | 'error'>('loading')
/** 已发起的重试次数 */
const attempt = ref(0)
let retryTimer: ReturnType<typeof setTimeout> | undefined

const currentSrc = computed(() => withRetryParam(props.src, attempt.value))

function clearRetryTimer() {
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
}

// src 变化时重置回 loading, 否则列表复用同一实例切图时新图片不显示 shimmer / 残留 error 态；
// 旧图的重试也要作废，否则会把新图换成旧图的重试地址
watch(
  () => props.src,
  () => {
    clearRetryTimer()
    attempt.value = 0
    state.value = 'loading'
  }
)

onBeforeUnmount(clearRetryTimer)

function onLoad() {
  state.value = 'loaded'
}

function onError() {
  state.value = 'error'
  const delay = LAZY_IMG_RETRY_DELAYS_MS[attempt.value]
  if (delay === undefined || retryTimer !== undefined) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    attempt.value += 1
    state.value = 'loading'
  }, delay)
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
  /* contain: 保留图标的透明 halo / 留白，不裁切（适合图标类用例 — 项目里 LazyImg 全用在图标） */
  object-fit: contain;
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
