<template>
  <section class="item-timeline">
    <div class="review-section-title">
      出装对比<span
        v-if="gapText"
        class="item-gap"
        :class="{ 'is-late': gapMinutes !== null && gapMinutes >= LATE_ITEM_MINUTES }"
        data-test="item-gap"
        >· {{ gapText }}</span
      >
    </div>

    <div class="item-row">
      <span class="item-row-label">{{ mine.label }}</span>
      <div class="item-track">
        <img
          v-for="it in mine.items"
          :key="`${it.itemId}-${it.ms}`"
          class="item-icon"
          :class="{ 'item-icon--boots': it.kind === 'boots' }"
          :src="getItemUrl(it.itemId)"
          :alt="it.name"
          :title="`${it.name} ${it.time}`"
          :style="{ left: `${pct(it.ms)}%` }"
          data-test="item-mine"
        />
      </div>
    </div>

    <div v-if="other" class="item-row">
      <span class="item-row-label">{{ other.label }}</span>
      <div class="item-track">
        <img
          v-for="it in other.items"
          :key="`${it.itemId}-${it.ms}`"
          class="item-icon"
          :class="{ 'item-icon--boots': it.kind === 'boots' }"
          :src="getItemUrl(it.itemId)"
          :alt="it.name"
          :title="`${it.name} ${it.time}`"
          :style="{ left: `${pct(it.ms)}%` }"
          data-test="item-other"
        />
      </div>
    </div>
    <div v-else-if="medianMs !== null" class="item-row">
      <span class="item-row-label">全场中位</span>
      <div class="item-track">
        <span
          class="item-median font-number"
          :style="{ left: `${pct(medianMs)}%` }"
          :title="`全场第一件传说装中位 ${fmtTime(medianMs)}`"
          data-test="item-median"
          >▲ {{ fmtTime(medianMs) }}</span
        >
      </div>
    </div>

    <div class="item-axis font-number">
      <span>0:00</span><span>{{ fmtTime(endMs) }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ⑥ 出装对比：选中玩家与对位（无分路时为全场第一件传说装中位）两条时间轴，
 * 标出传说装与鞋的成型时间，标题处标注第一件传说装的差距（≥2 分钟偏晚标红）。
 * @property mine - 选中玩家（label 为英雄名）
 * @property other - 对位玩家；无分路/无对位为 null
 * @property medianMs - 全场第一件传说装中位时刻（other 为 null 时作参照）
 * @property endMs - 时间轴终点（对局时长）
 */
import { computed } from 'vue'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { LATE_ITEM_MINUTES, type ItemMark } from '@renderer/services/ai/review/buildReviewModel'
import { fmtTime } from '@renderer/services/ai/shared/timeline/geometry'
import { xPercent } from './geometry'

const props = defineProps<{
  mine: { label: string; items: ItemMark[] }
  other: { label: string; items: ItemMark[] } | null
  medianMs: number | null
  endMs: number
}>()

const { getItemUrl } = useAssetUrl()

const pct = (ms: number): number => xPercent(ms, props.endMs)

const firstLegendary = (items: ItemMark[]): number | null =>
  items.find(i => i.kind === 'legendary')?.ms ?? null

/** 第一件传说装比参照晚多少分钟（早为负）；缺任一方为 null */
const gapMinutes = computed(() => {
  const a = firstLegendary(props.mine.items)
  const b = props.other ? firstLegendary(props.other.items) : props.medianMs
  return a === null || b === null ? null : (a - b) / 60000
})

/** 措辞与出装卡（cards/item.ts）一致 */
const gapText = computed(() => {
  const d = gapMinutes.value
  if (d === null) return null
  const ref = props.other ? '对位' : '全场中位'
  if (Math.abs(d) < 0.05) return `第一件传说装与${ref}同时`
  return `第一件传说装比${ref}${d > 0 ? '晚' : '早'} ${Math.abs(d).toFixed(1)} 分钟`
})
</script>

<style scoped>
.item-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.item-gap {
  margin-left: var(--space-4);
  font-weight: 400;
  color: var(--text-secondary);
}

.item-gap.is-late {
  color: var(--semantic-loss);
}

.item-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.item-row-label {
  width: 72px;
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-track {
  position: relative;
  flex: 1;
  height: 24px;
  border-bottom: 1px solid var(--border-subtle);
}

.item-icon {
  position: absolute;
  top: 2px;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  transform: translateX(-50%);
  border: 1px solid var(--accent-gold);
}

.item-icon--boots {
  border-color: var(--border-subtle);
}

.item-median {
  position: absolute;
  top: 4px;
  transform: translateX(-50%);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.item-axis {
  display: flex;
  justify-content: space-between;
  margin-left: 80px;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
</style>
