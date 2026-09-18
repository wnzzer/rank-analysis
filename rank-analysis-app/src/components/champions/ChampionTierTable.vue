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

/** 可排序的三列；key 同时是 TierRow 的字段名 */
const METRIC_COLUMNS: Array<{ key: 'winRate' | 'pickRate' | 'banRate'; label: string }> = [
  { key: 'winRate', label: '胜率' },
  { key: 'pickRate', label: '登场率' },
  { key: 'banRate', label: 'Ban 率' }
]

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

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
        :class="`row-tier-${row.tier}`"
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
        <span v-for="c in METRIC_COLUMNS" :key="c.key" class="col-metric">{{
          pct(row[c.key])
        }}</span>
        <span class="col-trend">
          <span
            v-if="notableTrend(row.trend)"
            class="trend-badge"
            :class="`trend-${row.trend.dir}`"
          >
            {{ row.trend.dir === 'up' ? '↑' : '↓' }}{{ row.trend.delta }}
          </span>
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
  gap: var(--space-4);
  font-size: var(--font-size-sm);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 给卡片阴影与悬浮上浮留出余量，否则会被滚动容器裁掉 */
  padding: 0 var(--space-6) var(--space-8) var(--space-2);
}

.champion-head,
.champion-row,
.champion-sk-row {
  display: grid;
  grid-template-columns: 44px minmax(120px, 220px) 64px repeat(3, minmax(88px, 1fr)) 60px;
  align-items: center;
  gap: var(--space-8);
  padding: 0 var(--space-12);
  /* 表格是竖排 flex 的滚动容器：不禁止收缩的话，行会被压到头像高度（38px → 24px） */
  flex: none;
}

.champion-head {
  height: 30px;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  /* 与卡片行的 1px 边框对齐 */
  border: 1px solid transparent;
  position: sticky;
  top: 0;
  /* 必须是不透明底色：--surface-card 是半透明叠加层，行会从表头字底下透出来 */
  background: var(--bg-base);
  z-index: 2;
}

.champion-row {
  height: 42px;
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--surface-card);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-sm), var(--glass-highlight);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-expo),
    box-shadow var(--dur-fast) var(--ease-expo);
}

/* 左侧 T 级色条：一眼扫出这条路的强弱分层，呼应对局卡的胜负条 */
.champion-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
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
  box-shadow: var(--shadow-md), var(--glass-highlight);
}

.champion-row:active {
  transform: scale(0.998);
  transition-duration: var(--dur-instant);
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
  height: 42px;
  border-radius: var(--radius-md);
  background: var(--surface-card);
  border: 1px solid var(--glass-border);
}

.sk-cell {
  height: 10px;
  border-radius: var(--radius-xs);
}
</style>
