<template>
  <div
    class="ring"
    :class="{ 'ring--urgent': urgent }"
    :style="{ width: size + 'px', height: size + 'px', '--deg': deg, '--ring-col': color }"
    role="img"
    :aria-label="ariaLabel"
  >
    <b v-if="label" class="ring__label num">{{ label }}</b>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * ChargeRing —— 充能环（设计系统 v3 §7.3）
 *
 * conic-gradient + radial mask 的进度环，复用场景：
 * BP 倒计时 / 收集进度 / 重新分析进度。
 * tone='brand' 且 percent<=20% 时自动转告急色（loss），
 * 也可用 tone='loss' 强制指定。
 */
const props = withDefaults(
  defineProps<{
    /** 进度百分比 0~100 */
    percent: number
    /** 直径 px */
    size?: number
    /** 色调 */
    tone?: 'brand' | 'win' | 'loss'
    /** 环心文字（如秒数），不传则只渲染环 */
    label?: string
  }>(),
  { size: 52, tone: 'brand', label: '' }
)

const clamped = computed(() => Math.min(100, Math.max(0, props.percent)))
/** 告急：brand 色且进度低于 20%（对应 BP 剩余约 5s） */
const urgent = computed(() => props.tone === 'brand' && clamped.value <= 20)
const color = computed(() => {
  if (props.tone === 'loss' || urgent.value) return 'var(--loss)'
  if (props.tone === 'win') return 'var(--win)'
  return 'var(--brand)'
})
const deg = computed(() => (clamped.value * 3.6).toFixed(1))
const ariaLabel = computed(() => `进度 ${Math.round(clamped.value)}%`)
</script>

<style scoped>
.ring {
  position: relative;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: conic-gradient(
    var(--ring-col, var(--brand)) calc(var(--deg) * 1deg),
    var(--bg-active) 0
  );
  -webkit-mask: radial-gradient(circle, transparent 58%, #000 61%);
  mask: radial-gradient(circle, transparent 58%, #000 61%);
}
.ring__label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--ring-col);
}
</style>
