<template>
  <section class="death-map">
    <div class="review-section-title">阵亡地图</div>
    <div class="death-map-board">
      <svg class="death-map-svg" viewBox="0 0 100 100" aria-hidden="true">
        <rect x="0" y="0" width="100" height="100" rx="4" class="death-map-ground" />
        <!-- 河道：x+y≈14800 的反对角线（左上 → 右下） -->
        <path d="M0 0 L100 100" class="death-map-river" />
        <!-- 三路：上路沿左/上边，中路沿对角线，下路沿下/右边 -->
        <path d="M7 93 L7 7 L93 7" class="death-map-lane" />
        <path d="M7 93 L93 7" class="death-map-lane" />
        <path d="M7 93 L93 93 L93 7" class="death-map-lane" />
        <circle cx="7" cy="93" r="6" class="death-map-base death-map-base--blue" />
        <circle cx="93" cy="7" r="6" class="death-map-base death-map-base--red" />
      </svg>
      <span
        v-for="d in placed"
        :key="d.index"
        class="death-map-dot"
        :class="{ 'is-hovered': hovered === d.index }"
        :style="dotStyle(d)"
        :title="`${d.time} ${d.zone} · ${RESPONSIBILITY_CN[d.resp]}`"
        data-test="map-dot"
        @mouseenter="emit('hover', d.index)"
        @mouseleave="emit('hover', null)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ⑤ 阵亡地图：简化召唤师峡谷（三路 + 河道 + 基地），阵亡点按坐标缩放、颜色 = 责任；
 * 与阵亡列表悬停联动。坐标映射是近似（与 zoneOf 同一坐标系）。只用于召唤师峡谷且有时间线时。
 * 无坐标（找不到对应击杀事件）的阵亡不画点，避免全部堆在蓝方基地。
 * @property deaths - 选中玩家的阵亡
 * @property hovered - 悬停中的阵亡序号
 * @emits hover - 悬停某点（序号；移出为 null）
 */
import { computed } from 'vue'
import { RESPONSIBILITY_CN, type DeathView } from '@renderer/services/ai/review/buildReviewModel'
import { mapPercent } from './geometry'

const props = defineProps<{ deaths: DeathView[]; hovered: number | null }>()

const emit = defineEmits<{ hover: [index: number | null] }>()

/** 有坐标的阵亡（序号保持原值，联动不错位） */
type PlacedDeath = DeathView & { x: number; y: number }
const placed = computed(() =>
  props.deaths.filter((d): d is PlacedDeath => d.x !== null && d.y !== null)
)

function dotStyle(d: PlacedDeath): Record<string, string> {
  const { left, top } = mapPercent(d.x, d.y)
  return { left: `${left}%`, top: `${top}%`, background: `var(--resp-${d.resp})` }
}
</script>

<style scoped>
.death-map-board {
  position: relative;
  width: 160px;
  height: 160px;
}

.death-map-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.death-map-ground {
  fill: color-mix(in srgb, var(--semantic-win) 14%, var(--bg-surface));
}

.death-map-river {
  stroke: color-mix(in srgb, var(--accent-sky) 45%, transparent);
  stroke-width: 6;
}

.death-map-lane {
  fill: none;
  stroke: color-mix(in srgb, var(--text-tertiary) 45%, transparent);
  stroke-width: 2.5;
}

.death-map-base--blue {
  fill: var(--side-blue);
}

.death-map-base--red {
  fill: var(--side-red);
}

.death-map-dot {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid var(--bg-base);
  transform: translate(-50%, -50%);
  transition: transform var(--dur-fast) var(--ease-expo);
}

.death-map-dot.is-hovered {
  transform: translate(-50%, -50%) scale(1.8);
  z-index: 1;
}
</style>
