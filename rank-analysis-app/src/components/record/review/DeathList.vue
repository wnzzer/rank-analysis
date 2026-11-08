<template>
  <section ref="root" class="death-list">
    <div class="review-section-title">阵亡与责任</div>
    <div v-if="loading && deaths === null" class="death-list-empty" data-test="death-loading">
      时间线加载中…
    </div>
    <div v-else-if="deaths === null" class="death-list-empty" data-test="death-summary">
      {{ summary }}
    </div>
    <template v-else>
      <div v-if="deaths.length === 0" class="death-list-empty">本局未阵亡</div>
      <div
        v-for="d in deaths"
        :key="d.index"
        class="death-row"
        :class="{ 'is-hovered': hovered === d.index, 'is-focused': focused === d.index }"
        data-test="death-row"
        :data-index="d.index"
        @mouseenter="emit('hover', d.index)"
        @mouseleave="emit('hover', null)"
      >
        <span class="death-time font-number">{{ d.time }}</span>
        <span class="death-zone">{{ d.zone }}</span>
        <span class="death-killer" :title="d.assists.length ? `助攻：${d.assists.join('、')}` : ''"
          >{{ d.killer }}<template v-if="d.assists.length"> +{{ d.assists.length }}</template></span
        >
        <span class="death-kind">{{ d.kindCn }}</span>
        <span class="death-chip" :class="`death-chip--${d.resp}`">{{
          RESPONSIBILITY_CN[d.resp]
        }}</span>
      </div>
      <div v-if="counts && deaths.length" class="death-counts" data-test="death-counts">
        共 {{ deaths.length }} 次：{{ countsText }}
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * ④ 阵亡与责任：选中玩家每次阵亡一行（时间、地点、击杀者、类型、责任徽章），末行分类计数。
 * 无时间线时只显示小结「阵亡 N 次（无时间线，无法细分）」。悬停与阵亡地图联动；
 * focused（AI 引用 [D4] 定位）变化时滚到该行。
 * @property deaths - 阵亡列表；无时间线为 null
 * @property summary - 阵亡归类小结（无时间线时展示）
 * @property counts - 责任分档计数；无时间线为 null
 * @property loading - 时间线加载中（显示加载提示代替小结）
 * @property hovered / focused - 悬停中 / 被定位的阵亡序号
 * @emits hover - 悬停某行（序号；移出为 null）
 */
import { computed, nextTick, ref, watch } from 'vue'
import {
  RESPONSIBILITY_CN,
  RESPONSIBILITY_ORDER,
  type DeathView,
  type Responsibility
} from '@renderer/services/ai/review/buildReviewModel'

const props = defineProps<{
  deaths: DeathView[] | null
  summary: string
  counts: Record<Responsibility, number> | null
  hovered: number | null
  focused: number | null
  /** 时间线加载中：无时间线的小结先不显示，避免闪现「无法细分」 */
  loading?: boolean
}>()

const emit = defineEmits<{ hover: [index: number | null] }>()

const root = ref<HTMLElement | null>(null)

/** 「自身问题 4 · 部分责任 1 · …」，省略 0 次的分档 */
const countsText = computed(() => {
  const c = props.counts
  if (!c) return ''
  return RESPONSIBILITY_ORDER.filter(r => c[r] > 0)
    .map(r => `${RESPONSIBILITY_CN[r]} ${c[r]}`)
    .join(' · ')
})

watch(
  () => props.focused,
  async index => {
    if (index === null) return
    await nextTick()
    const row = root.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }
)
</script>

<style scoped>
.death-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
}

.death-list-empty {
  color: var(--text-tertiary);
}

.death-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
}

.death-row.is-hovered {
  background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
}

.death-row.is-focused {
  outline: 1px solid var(--accent-gold);
}

.death-time {
  color: var(--text-primary);
}

.death-zone,
.death-killer,
.death-kind {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.death-chip {
  padding: 0 var(--space-6);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-2xs);
  white-space: nowrap;
}

.death-chip--self {
  color: var(--resp-self);
  background: color-mix(in srgb, var(--resp-self) 16%, transparent);
}

.death-chip--partial {
  color: var(--resp-partial);
  background: color-mix(in srgb, var(--resp-partial) 16%, transparent);
}

.death-chip--excused {
  color: var(--resp-excused);
  background: color-mix(in srgb, var(--resp-excused) 16%, transparent);
}

.death-chip--fight,
.death-chip--other {
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--resp-other) 16%, transparent);
}

.death-counts {
  margin-top: var(--space-4);
  color: var(--text-tertiary);
}
</style>
