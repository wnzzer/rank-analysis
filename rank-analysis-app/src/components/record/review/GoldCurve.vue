<template>
  <section class="gold-curve">
    <div class="review-section-title">
      经济差曲线（上 = 蓝方领先）<span class="gold-curve-legend" data-test="curve-legend"
        >⚔️ 团战 ·
        <ObjectiveIcon monster="DRAGON" sub-type="FIRE_DRAGON" :size="14" />
        <ObjectiveIcon monster="BARON_NASHOR" :size="14" />
        <ObjectiveIcon monster="HORDE" :size="14" /> 资源（外圈 = 拿下方） · ● 选中玩家阵亡（颜色 =
        责任）</span
      >
    </div>
    <div
      ref="plotEl"
      class="gold-curve-plot"
      data-test="curve-plot"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <svg class="gold-curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          class="gold-curve-zero"
          vector-effect="non-scaling-stroke"
        />
        <path :d="path" class="gold-curve-line" vector-effect="non-scaling-stroke" />
      </svg>

      <button
        v-for="m in curve.markers"
        :key="m.id"
        type="button"
        class="gold-curve-marker"
        :class="[`gold-curve-marker--${m.kind}`, { 'is-open': openId === m.id }]"
        :style="{ left: `${x(m.minute)}%` }"
        :title="m.title"
        data-test="curve-marker"
        :data-id="m.id"
        @click.stop="emit('update:openId', openId === m.id ? null : m.id)"
      >
        <template v-if="m.kind === 'fight'">⚔️</template>
        <ObjectiveIcon v-else :monster="m.monster" :sub-type="m.subType" :side="m.side" />
      </button>

      <span
        v-for="d in deaths ?? []"
        :key="d.index"
        class="gold-curve-death"
        :style="{ left: `${x(d.ms / 60000)}%`, background: `var(--resp-${d.resp})` }"
        :title="`${d.time} ${d.kindCn}`"
        data-test="curve-death"
      />

      <div
        v-if="hover"
        class="gold-curve-readout"
        :style="{ left: `${x(hover.minute)}%` }"
        data-test="curve-readout"
      >
        {{ leadText(hover) }}
      </div>

      <div
        v-if="openMarker"
        class="gold-curve-popover"
        :class="{ 'gold-curve-popover--flip': x(openMarker.minute) > 60 }"
        :style="{ left: `${x(openMarker.minute)}%` }"
        data-test="curve-popover"
        @click.stop
      >
        <div class="gold-curve-popover-title">{{ openMarker.title }}</div>
        <template v-if="openMarker.kind === 'fight'">
          <div v-for="line in openMarker.lines" :key="line" class="gold-curve-popover-line">
            {{ line }}
          </div>
        </template>
        <button
          type="button"
          class="gold-curve-popover-close"
          aria-label="关闭"
          @click="emit('update:openId', null)"
        >
          ×
        </button>
      </div>
    </div>
    <div class="gold-curve-axis font-number">
      <span>0:00</span><span>{{ endText }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ③ 经济差曲线：两队经济差逐分钟折线（上 = 蓝方领先），叠加团战 ⚔️ / 资源（分野怪 SVG 图标）标记与选中玩家阵亡点。
 * 悬停读时刻与经济差；点 ⚔️/🐉 弹出详情卡（受控：openId 由父组件持有，AI 引用 [F3] 可直接打开）。
 * @property curve - 曲线与标记
 * @property deaths - 选中玩家的阵亡（颜色 = 责任）；无为 null
 * @property openId - 当前展开的标记 id（F 卡编号 / O 序号）
 * @emits update:openId - 点击标记或关闭弹出卡
 */
import { computed, ref } from 'vue'
import type {
  CurvePoint,
  DeathView,
  GoldCurve
} from '@renderer/services/ai/review/buildReviewModel'
import { fmtTime } from '@renderer/services/ai/shared/timeline/geometry'
import { curvePath, leadText, nearestPoint, xPercent } from './geometry'
import ObjectiveIcon from './ObjectiveIcon.vue'

const props = defineProps<{
  curve: GoldCurve
  deaths: DeathView[] | null
  openId: string | null
}>()

const emit = defineEmits<{ 'update:openId': [id: string | null] }>()

const plotEl = ref<HTMLElement | null>(null)
const hover = ref<CurvePoint | null>(null)

const x = (minute: number): number => xPercent(minute, props.curve.endMinute)
const path = computed(() =>
  curvePath(props.curve.points, props.curve.endMinute, props.curve.maxAbs)
)
const endText = computed(() => fmtTime(props.curve.endMinute * 60000))
const openMarker = computed(() => props.curve.markers.find(m => m.id === props.openId) ?? null)

function onMove(e: MouseEvent): void {
  const rect = plotEl.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0) return
  const minute = ((e.clientX - rect.left) / rect.width) * props.curve.endMinute
  hover.value = nearestPoint(props.curve.points, minute)
}
</script>

<style scoped>
.gold-curve-legend {
  margin-left: var(--space-8);
  color: var(--text-tertiary);
  font-weight: 400;
}

.gold-curve-plot {
  position: relative;
  height: 140px;
}

.gold-curve-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.gold-curve-zero {
  stroke: var(--border-subtle);
  stroke-width: 1;
}

.gold-curve-line {
  fill: none;
  stroke: var(--side-blue);
  stroke-width: 2;
}

.gold-curve-marker {
  position: absolute;
  transform: translateX(-50%);
  padding: 0;
  border: none;
  background: transparent;
  font-size: var(--font-size-sm);
  line-height: 1;
  cursor: pointer;
  opacity: 0.85;
}

.gold-curve-marker:hover,
.gold-curve-marker.is-open {
  opacity: 1;
  transform: translateX(-50%) scale(1.25);
}

.gold-curve-marker--fight {
  top: 2px;
}

.gold-curve-marker--objective {
  top: 20px;
}

.gold-curve-death {
  position: absolute;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateX(-50%);
}

.gold-curve-readout {
  position: absolute;
  top: 40px;
  transform: translateX(-50%);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-2xs);
  white-space: nowrap;
  pointer-events: none;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
}

.gold-curve-popover {
  position: absolute;
  top: 36px;
  z-index: 2;
  min-width: 220px;
  max-width: 360px;
  padding: var(--space-8) var(--space-24) var(--space-8) var(--space-10);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}

.gold-curve-popover--flip {
  transform: translateX(-100%);
}

.gold-curve-popover-title {
  font-weight: 600;
  color: var(--text-primary);
}

.gold-curve-popover-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-6);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.gold-curve-axis {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
</style>
