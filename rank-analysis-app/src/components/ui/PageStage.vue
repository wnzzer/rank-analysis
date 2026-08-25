<template>
  <section ref="stageEl" class="pstage" :class="{ 'pstage--compact': compact }">
    <canvas ref="emberCanvas" class="pstage__ember" aria-hidden="true"></canvas>
    <div class="pstage__shards" aria-hidden="true">
      <svg
        v-for="(s, i) in shards"
        :key="i"
        class="shard"
        :style="{
          left: s.x,
          top: s.y,
          width: s.size,
          '--p': s.depth,
          '--float-d': s.floatDur + 's',
          animationDelay: s.delay
        }"
        viewBox="0 0 100 100"
        fill="none"
      >
        <polygon points="50,3 93,26 93,74 50,97 7,74 7,26" stroke="currentColor" stroke-width="2" />
      </svg>
    </div>
    <div class="pstage__veil" aria-hidden="true"></div>

    <div class="pstage__inner">
      <p v-if="kicker" class="pstage__kicker reveal" style="--d: 0">
        <span class="kicker-dot" aria-hidden="true"></span>
        {{ kicker }}
      </p>
      <h1 class="pstage__title reveal" style="--d: 60ms">
        <span class="pstage__line">{{ title }}</span>
        <span v-if="ghost" class="pstage__line pstage__line--ghost">{{ ghost }}</span>
      </h1>
      <p v-if="sub || $slots.meta" class="pstage__meta reveal" style="--d: 200ms">
        <span v-if="sub">{{ sub }}</span>
        <span v-if="sub && $slots.meta" class="meta-sep" aria-hidden="true">/</span>
        <slot name="meta" />
      </p>
      <div v-if="$slots.actions" class="pstage__acts reveal" style="--d: 280ms">
        <slot name="actions" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * PageStage —— 沉浸式页面横幅（旗舰语言复用件）
 *
 * 余烬粒子场（useEmberField）+ 六边形碎片视差层 + Syncopate 双段标题。
 * 视差由 pointer 驱动（rAF 节流）；prefers-reduced-motion 全降级；
 * jsdom 测试环境静默跳过。cold=true 时粒子减量转灰（离线冷却态）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEmberField } from '../../composables/useEmberField'

const props = withDefaults(
  defineProps<{
    /** 眉题（等宽体大写字距） */
    kicker?: string
    /** 主标题（Syncopate 实心巨字；CJK 自动回退系统黑体） */
    title: string
    /** 幽灵行（描边空心，弱一档字号） */
    ghost?: string
    /** 说明行 */
    sub?: string
    /** 冷却态：粒子减量转灰 */
    cold?: boolean
    /** 紧凑高度（次级页面用） */
    compact?: boolean
  }>(),
  { kicker: '', ghost: '', sub: '', cold: false, compact: false }
)

const reducedMotion = ref(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
)
const emberCanvas = ref<HTMLCanvasElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)

const shards = [
  { x: '6%', y: '20%', size: '72px', depth: 1.4, floatDur: 9, delay: '0s' },
  { x: '82%', y: '14%', size: '48px', depth: 2.2, floatDur: 7, delay: '-2s' },
  { x: '90%', y: '62%', size: '104px', depth: 0.9, floatDur: 11, delay: '-4s' },
  { x: '70%', y: '70%', size: '56px', depth: 1.8, floatDur: 10, delay: '-5s' }
]

let parallaxRaf = 0
let pmx = 0
let pmy = 0

function applyParallax() {
  parallaxRaf = 0
  const el = stageEl.value
  if (!el) return
  el.style.setProperty('--mx', pmx.toFixed(3))
  el.style.setProperty('--my', pmy.toFixed(3))
}
function onStagePointer(e: PointerEvent) {
  if (reducedMotion.value || e.pointerType !== 'mouse') return
  const r = stageEl.value?.getBoundingClientRect()
  if (!r) return
  pmx = (e.clientX - r.left) / r.width - 0.5
  pmy = (e.clientY - r.top) / r.height - 0.5
  if (!parallaxRaf) parallaxRaf = requestAnimationFrame(applyParallax)
}

onMounted(() => {
  if (/jsdom/i.test(window.navigator?.userAgent ?? '')) return
  window.addEventListener('pointermove', onStagePointer, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onStagePointer)
  if (parallaxRaf) cancelAnimationFrame(parallaxRaf)
})

useEmberField(emberCanvas, {
  cold: computed(() => props.cold)
})
</script>

<style scoped>
.pstage {
  --mx: 0;
  --my: 0;
  position: relative;
  overflow: hidden;
  min-height: clamp(300px, 38vh, 440px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-bottom: 1px solid var(--border-subtle);
  background:
    radial-gradient(
      130% 110% at 82% 0%,
      color-mix(in srgb, var(--brand) 9%, transparent),
      transparent 55%
    ),
    radial-gradient(
      90% 90% at 10% 92%,
      color-mix(in srgb, var(--info) 6%, transparent),
      transparent 58%
    ),
    var(--bg-sunken);
}
.pstage--compact {
  min-height: clamp(220px, 28vh, 320px);
}
.pstage__ember {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.pstage__shards {
  position: absolute;
  inset: 0;
}
.shard {
  position: absolute;
  color: var(--brand);
  opacity: 0.15;
  translate: calc(var(--mx) * var(--p) * -22px) calc(var(--my) * var(--p) * -16px);
  transition: translate 0.25s ease-out;
  animation: pstage-float var(--float-d, 9s) ease-in-out infinite alternate;
}
.pstage__veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent 58%, var(--bg-base));
}
.pstage__veil::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--noise-img);
  opacity: 0.06;
}
.pstage__inner {
  position: relative;
  z-index: 1;
  max-width: 1080px;
  margin: 0 auto;
  width: 100%;
  padding: 56px var(--space-24) 44px;
  translate: calc(var(--mx) * 10px) calc(var(--my) * 6px);
  transition: translate 0.3s ease-out;
}
.pstage--compact .pstage__inner {
  padding: 36px var(--space-24) 32px;
}
.pstage__kicker {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-xs);
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--brand);
}
.kicker-dot {
  width: 7px;
  height: 7px;
  transform: rotate(45deg);
  background: var(--brand);
  box-shadow: var(--glow-brand);
}
.pstage__title {
  margin: var(--space-12) 0 var(--space-10);
  font-family: 'Syncopate', 'Bahnschrift', 'Segoe UI', sans-serif;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
}
.pstage__line {
  display: block;
  font-size: clamp(34px, 5.6vw, 64px);
  letter-spacing: 0.02em;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.pstage__line--ghost {
  color: transparent;
  -webkit-text-stroke: 1.5px var(--brand);
  opacity: 0.85;
  font-size: clamp(22px, 3.4vw, 40px);
  padding-top: 8px;
}
.pstage__meta {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
.meta-sep {
  color: var(--text-tertiary);
}
.pstage__acts {
  margin-top: var(--space-16);
}

.reveal {
  animation: pstage-rise 0.75s var(--ease-expo) both;
  animation-delay: calc(var(--d, 0) * 1ms);
}
@keyframes pstage-float {
  from {
    transform: translateY(-8px) rotate(-4deg);
  }
  to {
    transform: translateY(10px) rotate(5deg);
  }
}
@keyframes pstage-rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    animation: none;
  }
  .shard {
    translate: none !important;
    animation: none;
  }
  .pstage__inner {
    translate: none;
  }
}
</style>
