<script setup lang="ts">
/**
 * 英雄榜表格（单路榜单）
 *
 * 纯展示：行数据、排序状态、迷你条的归一基准都由页面给出，点行只发 select。
 * 自绘表格而不是 n-data-table——行里要塞头像 / T 级徽章 / 迷你条 / 趋势徽章，
 * 列头排序也只有三列需要，自绘比给 n-data-table 写一堆 render 函数更好读。
 */
import { computed } from 'vue'
import { assetPrefix } from '@renderer/services/http'
import { notableTrend, type MetricMaxima, type SortKey, type TierRow } from './championTier'

const props = withDefaults(
  defineProps<{
    rows: TierRow[]
    /** 当前分路全量行的三个指标最大值（见 championTier 的 maximaOf） */
    maxima: MetricMaxima
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

/** 可排序的三列；key 同时是 TierRow 与 MetricMaxima 的字段名 */
const METRIC_COLUMNS: Array<{ key: keyof MetricMaxima & SortKey; label: string }> = [
  { key: 'winRate', label: '胜率' },
  { key: 'pickRate', label: '登场率' },
  { key: 'banRate', label: 'Ban 率' }
]

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/**
 * 迷你条宽度
 *
 * 基准是页面传来的全量最大值而不是当前行集：搜索只剩一个英雄时，按行集算会让
 * 它的条变满格，看着像它最强。
 */
function barWidth(key: keyof MetricMaxima, row: TierRow): string {
  const max = props.maxima[key]
  return max > 0 ? `${Math.round((row[key] / max) * 100)}%` : '0%'
}

const empty = computed(() => !props.loading && props.rows.length === 0)
</script>

<template>
  <div class="champion-table">
    <div class="champion-head">
      <span class="col-rank">榜位</span>
      <span class="col-champion">英雄</span>
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
      <div v-for="i in 8" :key="i" class="champion-sk-row">
        <span v-for="n in 7" :key="n" class="sk sk-cell" />
      </div>
    </div>

    <div v-else-if="empty" class="champion-empty">没有匹配的英雄</div>

    <template v-else>
      <div
        v-for="row in rows"
        :key="`${row.championId}-${row.position}`"
        class="champion-row"
        @click="$emit('select', row)"
      >
        <span class="col-rank">{{ row.rank }}</span>
        <span class="col-champion">
          <img class="champion-avatar" :src="`${assetPrefix}/champion/${row.championId}`" alt="" />
          {{ row.name }}
        </span>
        <span class="col-tier">
          <span class="tier-badge" :class="`tier-${row.tier}`">T{{ row.tier }}</span>
        </span>
        <span v-for="c in METRIC_COLUMNS" :key="c.key" class="col-metric">
          <b>{{ pct(row[c.key]) }}</b>
          <span class="metric-track">
            <span
              class="metric-fill"
              :class="`fill-${c.key}`"
              :style="{ width: barWidth(c.key, row) }"
            />
          </span>
        </span>
        <span class="col-trend">
          <span v-if="notableTrend(row.trend)" class="trend-badge" :class="`trend-${row.trend.dir}`">
            {{ row.trend.dir === 'up' ? '↑' : '↓' }}{{ row.trend.delta }}
          </span>
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
.champion-row,
.champion-sk-row {
  display: grid;
  grid-template-columns: 40px minmax(120px, 1fr) 60px repeat(3, 116px) 56px;
  align-items: center;
  gap: var(--space-8);
  padding: 0 var(--space-12);
}

.champion-head {
  height: 30px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  background: var(--surface-card);
  z-index: 1;
}

.champion-row {
  height: 38px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-expo);
}

.champion-row:hover {
  background: var(--surface-sunken);
}

.col-rank {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.col-champion {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.champion-avatar {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  flex: none;
}

/* T 级徽章：0 最强，5 最弱 */
.tier-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 18px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-xs);
  font-weight: 700;
}

.tier-0 {
  background: var(--accent-gold);
  /* 金底配深字，亮暗两套都是同一块金色，不随主题走 (theme-fixed) */
  color: #1b1205;
}
.tier-1 {
  background: color-mix(in srgb, var(--semantic-win) 18%, transparent);
  color: var(--semantic-win);
}
.tier-2 {
  background: color-mix(in srgb, var(--accent-sky) 16%, transparent);
  color: var(--accent-sky);
}
.tier-3 {
  background: color-mix(in srgb, var(--text-secondary) 14%, transparent);
  color: var(--text-secondary);
}
.tier-4,
.tier-5 {
  background: color-mix(in srgb, var(--text-tertiary) 10%, transparent);
  color: var(--text-tertiary);
}

.col-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.col-metric b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.metric-track {
  width: 100%;
  height: 3px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--text-tertiary) 22%, transparent);
  overflow: hidden;
}

.metric-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-xs);
}

.fill-winRate {
  background: var(--semantic-win);
}
.fill-pickRate {
  background: var(--accent-blue);
}
.fill-banRate {
  background: var(--semantic-loss);
}

.col-sortable {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: inherit;
  padding: 0;
  align-items: flex-end;
}

.col-sorted {
  color: var(--text-primary);
  font-weight: 600;
}

.col-trend {
  text-align: right;
}

.trend-badge {
  display: inline-block;
  padding: 1px var(--space-6);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.trend-up {
  background: color-mix(in srgb, var(--semantic-win) 14%, transparent);
  color: var(--semantic-win);
}

.trend-down {
  background: color-mix(in srgb, var(--semantic-loss) 12%, transparent);
  color: var(--semantic-loss);
}

.champion-empty {
  padding: var(--space-24);
  text-align: center;
  color: var(--text-tertiary);
}

.champion-skeleton {
  display: flex;
  flex-direction: column;
}

.champion-sk-row {
  height: 38px;
  border-bottom: 1px solid var(--border-subtle);
}

.sk-cell {
  height: 10px;
  border-radius: var(--radius-xs);
}
</style>
