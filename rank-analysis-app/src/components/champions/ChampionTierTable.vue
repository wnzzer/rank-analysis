<script setup lang="ts">
/**
 * 英雄榜表格
 *
 * 纯展示：行数据、排序状态都由页面给出，点行只发 select。自绘表格而不是
 * n-data-table——行里要塞头像 / T 级色块 / 趋势箭头，列头排序也只有三列需要，
 * 自绘比给 n-data-table 写一堆 render 函数更好读。
 */
import { computed } from 'vue'
import { assetPrefix } from '@renderer/services/http'
import type { SortKey, TierRow } from './championTier'

const props = withDefaults(
  defineProps<{
    rows: TierRow[]
    loading?: boolean
    sortKey?: SortKey
    sortDesc?: boolean
  }>(),
  { loading: false, sortKey: 'default', sortDesc: true }
)

defineEmits<{
  (e: 'select', row: TierRow): void
  (e: 'sort', key: SortKey): void
}>()

const POSITION_LABELS: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/** 可排序的三列 */
const METRIC_COLUMNS: Array<{ key: SortKey; label: string; of: (r: TierRow) => number }> = [
  { key: 'winRate', label: '胜率', of: r => r.winRate },
  { key: 'pickRate', label: '登场率', of: r => r.pickRate },
  { key: 'banRate', label: 'Ban 率', of: r => r.banRate }
]

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const positionLabel = (p: string) => POSITION_LABELS[p] ?? p

const empty = computed(() => !props.loading && props.rows.length === 0)

function trendText(row: TierRow): string {
  const { dir, delta } = row.trend
  if (dir === 'none') return '—'
  if (dir === 'flat') return '→'
  return `${dir === 'up' ? '↑' : '↓'}${delta}`
}
</script>

<template>
  <div class="champion-table">
    <div class="champion-head">
      <span class="col-index">#</span>
      <span class="col-champion">英雄</span>
      <span class="col-position">分路</span>
      <span class="col-tier">T 级</span>
      <button
        v-for="c in METRIC_COLUMNS"
        :key="c.key"
        type="button"
        class="col-metric col-sortable"
        :class="{ 'col-sorted': sortKey === c.key }"
        @click="$emit('sort', c.key)"
      >
        {{ c.label }}<span v-if="sortKey === c.key">{{ sortDesc ? ' ↓' : ' ↑' }}</span>
      </button>
      <span class="col-trend">趋势</span>
    </div>

    <div v-if="loading" class="champion-skeleton">
      <span v-for="i in 8" :key="i" class="sk champion-sk-row" />
    </div>

    <div v-else-if="empty" class="champion-empty">没有匹配的英雄</div>

    <template v-else>
      <div
        v-for="(row, i) in rows"
        :key="`${row.championId}-${row.position}`"
        class="champion-row"
        @click="$emit('select', row)"
      >
        <span class="col-index">{{ i + 1 }}</span>
        <span class="col-champion">
          <img class="champion-avatar" :src="`${assetPrefix}/champion/${row.championId}`" alt="" />
          {{ row.name }}
        </span>
        <span class="col-position">{{ positionLabel(row.position) }}</span>
        <span class="col-tier" :class="`tier-${row.tier}`">T{{ row.tier }}</span>
        <span v-for="c in METRIC_COLUMNS" :key="c.key" class="col-metric">{{
          pct(c.of(row))
        }}</span>
        <span class="col-trend champion-trend" :class="`trend-${row.trend.dir}`">
          {{ trendText(row) }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.champion-table {
  display: flex;
  flex-direction: column;
  font-size: var(--font-size-sm);
}

.champion-head,
.champion-row {
  display: grid;
  grid-template-columns: 40px minmax(140px, 1.4fr) 72px 56px repeat(3, 84px) 64px;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-12);
}

.champion-head {
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  background: var(--surface-card);
  z-index: 1;
}

.champion-row {
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-expo);
}

.champion-row:hover {
  background: var(--surface-sunken);
}

.col-champion {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-weight: 600;
}

.champion-avatar {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
}

.col-metric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.col-sortable {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: inherit;
  padding: 0;
}

.col-sorted {
  color: var(--text-primary);
  font-weight: 600;
}

.col-trend {
  text-align: right;
}

/* T 级：1 最强，5 最弱 */
.tier-1 {
  color: var(--semantic-win);
  font-weight: 700;
}
.tier-2 {
  color: var(--accent-sky);
}
.tier-3 {
  color: var(--text-secondary);
}
.tier-4,
.tier-5 {
  color: var(--text-tertiary);
}

.trend-up {
  color: var(--semantic-win);
}
.trend-down {
  color: var(--semantic-loss);
}
.trend-flat,
.trend-none {
  color: var(--text-tertiary);
}

.champion-empty {
  padding: var(--space-24);
  text-align: center;
  color: var(--text-tertiary);
}

.champion-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-12);
}

.champion-sk-row {
  height: 28px;
}
</style>
