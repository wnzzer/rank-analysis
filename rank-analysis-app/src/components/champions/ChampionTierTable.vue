<script setup lang="ts">
/**
 * 英雄榜表格（单路榜单）
 *
 * 纯展示：行数据、排序状态由页面给出，点行只发 select。
 * 自绘表格而不是 n-data-table——行里要塞头像 / T 级徽章 / 迷你条 / 趋势徽章，
 * 列头排序也只有三列需要，自绘比给 n-data-table 写一堆 render 函数更好读。
 */
import { computed } from 'vue'
import { assetPrefix } from '@renderer/services/http'
import { notableTrend, type SortKey, type TierRow } from './championTier'

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

type MetricKey = 'winRate' | 'pickRate' | 'banRate'

/** 可排序的三列；key 同时是 TierRow 的字段名 */
const METRIC_COLUMNS: Array<{ key: MetricKey; label: string }> = [
  { key: 'winRate', label: '胜率' },
  { key: 'pickRate', label: '登场率' },
  { key: 'banRate', label: 'Ban 率' }
]

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

const empty = computed(() => !props.loading && props.rows.length === 0)

/**
 * 迷你条的归一基准：当前可见行里的最大值
 * 登场 / Ban 率的绝对值很小（多在 0~20%），按 100% 画会一条都看不见，按榜内最大值才有对比
 */
const maxOf = computed(() => {
  const max = (k: MetricKey) => Math.max(...props.rows.map(r => r[k]), 0.0001)
  return { winRate: max('winRate'), pickRate: max('pickRate'), banRate: max('banRate') }
})

/**
 * 迷你条宽度（%）
 * 胜率只在 45%~55% 之间有区分度：按这段区间拉伸，否则所有条都挤在一半长度
 */
function barOf(row: TierRow, key: MetricKey): number {
  if (key === 'winRate') return Math.min(100, Math.max(4, ((row.winRate - 0.45) / 0.1) * 100))
  return Math.max(4, (row[key] / maxOf.value[key]) * 100)
}

/** 胜率冷暖色：52% 以上偏强、48% 以下偏弱，中间不着色，免得满屏红绿 */
function winClass(v: number): string {
  if (v >= 0.52) return 'metric-good'
  if (v < 0.48) return 'metric-bad'
  return ''
}
</script>

<template>
  <div class="champion-table">
    <div class="champion-head">
      <span class="col-rank">#</span>
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
        {{ c.label
        }}<span class="sort-arrow">{{ sortKey === c.key ? (sortDesc ? '↓' : '↑') : '↕' }}</span>
      </button>
      <span class="col-trend">趋势</span>
    </div>

    <div v-if="loading" class="champion-skeleton">
      <div v-for="i in 10" :key="i" class="champion-sk-row">
        <span class="sk sk-rank" />
        <span class="sk-champion"><span class="sk sk-avatar" /><span class="sk sk-name" /></span>
        <span class="sk sk-tier" />
        <span v-for="n in 3" :key="n" class="sk sk-metric" />
        <span />
      </div>
    </div>

    <div v-else-if="empty" class="champion-empty">没有匹配的英雄</div>

    <template v-else>
      <div
        v-for="row in rows"
        :key="`${row.championId}-${row.position}`"
        class="champion-row"
        :class="`row-tier-${row.tier}`"
        @click="$emit('select', row)"
      >
        <span class="col-rank" :class="{ 'rank-top': row.rank <= 3 }">{{ row.rank }}</span>
        <span class="col-champion">
          <img class="champion-avatar" :src="`${assetPrefix}/champion/${row.championId}`" alt="" />
          <span class="champion-name">{{ row.name }}</span>
        </span>
        <span class="col-tier">
          <span class="tier-badge" :class="`tier-${row.tier}`">T{{ row.tier }}</span>
        </span>
        <span
          v-for="c in METRIC_COLUMNS"
          :key="c.key"
          class="col-metric"
          :class="[
            `metric-${c.key}`,
            { 'metric-active': sortKey === c.key },
            c.key === 'winRate' ? winClass(row.winRate) : ''
          ]"
        >
          <span class="metric-value">{{ pct(row[c.key]) }}</span>
          <span class="metric-track"
            ><span class="metric-bar" :style="{ width: `${barOf(row, c.key)}%` }"
          /></span>
        </span>
        <span class="col-trend">
          <span
            v-if="notableTrend(row.trend)"
            class="trend-badge"
            :class="`trend-${row.trend.dir}`"
          >
            {{ row.trend.dir === 'up' ? '↑' : '↓' }}{{ row.trend.delta }}
          </span>
          <span v-else class="trend-none">—</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * 行是一张张小卡而不是画横线的表：亮色主题是「浅灰画布 → 白卡」，直接在画布上
 * 画线会变成线表。与战绩页的对局卡同一套材质（卡面 / 细边 / 软阴影 / 左侧色条）。
 */
.champion-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  font-size: var(--font-size-base);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 给卡片阴影与悬浮上浮留出余量，否则会被滚动容器裁掉 */
  padding: 0 var(--space-6) var(--space-12) var(--space-2);
}

.champion-head,
.champion-row,
.champion-sk-row {
  display: grid;
  grid-template-columns: 36px minmax(160px, 1.3fr) 56px repeat(3, minmax(96px, 1fr)) 56px;
  align-items: center;
  column-gap: var(--space-20);
  padding: 0 var(--space-16) 0 var(--space-20);
  /* 表格是竖排 flex 的滚动容器：不禁止收缩的话，行会被压扁 */
  flex: none;
}

.champion-head {
  height: 32px;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  letter-spacing: 0.04em;
  /* 与卡片行的 1px 边框对齐 */
  border: 1px solid transparent;
  position: sticky;
  top: 0;
  /* 必须是不透明底色：--surface-card 是半透明叠加层，行会从表头字底下透出来 */
  background: var(--bg-base);
  z-index: 2;
}

.champion-row {
  height: 56px;
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-sm), var(--glass-highlight);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-expo),
    box-shadow var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}

/* 左侧 T 级色条：一眼扫出这条路的强弱分层，呼应对局卡的胜负条 */
.champion-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 0 var(--radius-pill) var(--radius-pill) 0;
  background: var(--tier-accent, transparent);
}

.row-tier-0 {
  --tier-accent: var(--accent-gold);
}
.row-tier-1 {
  --tier-accent: var(--semantic-win);
}
.row-tier-2 {
  --tier-accent: var(--accent-sky);
}
.row-tier-3 {
  --tier-accent: color-mix(in srgb, var(--text-tertiary) 55%, transparent);
}

.champion-row:hover {
  transform: translateY(-1px);
  border-color: color-mix(
    in srgb,
    var(--tier-accent, var(--text-tertiary)) 35%,
    var(--glass-border)
  );
  box-shadow: var(--shadow-md), var(--glass-highlight);
}

.champion-row:active {
  transform: scale(0.998);
  transition-duration: var(--dur-instant);
}

.col-rank {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.rank-top {
  color: var(--text-primary);
  font-weight: 700;
}

.col-champion {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  min-width: 0;
}

.champion-avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  flex: none;
  box-shadow: 0 0 0 1px var(--glass-border);
}

.champion-name {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* T 级徽章：0 最强，5 最弱 */
.tier-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 22px;
  padding: 0 var(--space-6);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.02em;
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

/* 指标：数字在上、细迷你条在下，右对齐成一列 */
.col-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  font-variant-numeric: tabular-nums;
  --bar-color: color-mix(in srgb, var(--text-tertiary) 70%, transparent);
}

.metric-value {
  color: var(--text-secondary);
  font-weight: 500;
}

.metric-track {
  width: 100%;
  max-width: 88px;
  height: 3px;
  border-radius: var(--radius-pill);
  background: var(--glass-bg-high);
  overflow: hidden;
  display: flex;
  justify-content: flex-end;
}

.metric-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--bar-color);
  transition: width var(--dur-fast) var(--ease-expo);
}

.metric-good {
  --bar-color: var(--semantic-win);
}
.metric-good .metric-value {
  color: var(--semantic-win);
}
.metric-bad {
  --bar-color: var(--semantic-loss);
}
.metric-bad .metric-value {
  color: var(--semantic-loss);
}
.metric-pickRate {
  --bar-color: var(--accent-sky);
}
.metric-banRate {
  --bar-color: var(--accent-gold);
}

/* 当前排序列加重，读榜时视线自然落在这一列 */
.metric-active .metric-value {
  color: var(--text-primary);
  font-weight: 700;
}
.metric-active.metric-good .metric-value {
  color: var(--semantic-win);
}
.metric-active.metric-bad .metric-value {
  color: var(--semantic-loss);
}

.col-sortable {
  display: inline-flex;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: inherit;
  letter-spacing: inherit;
  padding: 0;
  transition: color var(--dur-fast) var(--ease-expo);
}

.col-sortable:hover {
  color: var(--text-secondary);
}

.sort-arrow {
  opacity: 0.45;
}

.col-sorted {
  color: var(--text-primary);
  font-weight: 600;
}

.col-sorted .sort-arrow {
  opacity: 1;
}

.col-trend {
  text-align: right;
}

.trend-badge {
  display: inline-block;
  padding: 2px var(--space-6);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.trend-none {
  color: var(--text-tertiary);
  opacity: 0.5;
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
  padding: var(--space-28);
  text-align: center;
  color: var(--text-tertiary);
}

.champion-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.champion-sk-row {
  height: 56px;
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  border: 1px solid var(--glass-border);
}

.sk-rank {
  height: 10px;
  width: 16px;
  justify-self: center;
}

.sk-champion {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.sk-avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
}

.sk-name {
  height: 12px;
  width: 72px;
}

.sk-tier {
  height: 22px;
  width: 32px;
  border-radius: var(--radius-sm);
}

.sk-metric {
  height: 10px;
  width: 56px;
  justify-self: end;
}

.sk {
  border-radius: var(--radius-xs);
}
</style>
