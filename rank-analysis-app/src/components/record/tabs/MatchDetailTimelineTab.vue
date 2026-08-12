<template>
  <!-- 时间线 tab：SGP DETAILS 帧流（金/CS/经验曲线，自绘 SVG 折线）。
       LCU 战绩无 participantFrames——无数据时显示说明。 -->
  <div class="match-detail-timeline-tab">
    <div v-if="loading" class="match-detail-timeline-state">
      <n-spin size="small" />
      <span>正在加载帧数据…</span>
    </div>

    <div v-else-if="!hasData" class="match-detail-timeline-state">
      <span class="match-detail-timeline-state-title">无曲线数据</span>
      <span class="match-detail-timeline-state-desc">
        逐分钟金 / CS / 经验曲线来自 SGP 数据源；LCU 战绩无
        participantFrames。跨区/腾讯通道战绩可加载。
      </span>
    </div>

    <template v-else>
      <!-- 控制面板：指标切换 + 玩家多选 -->
      <div class="match-detail-timeline-controls">
        <div class="match-detail-timeline-metrics" role="radiogroup" aria-label="曲线指标">
          <button
            v-for="m in TIMELINE_METRICS"
            :key="m.kind"
            type="button"
            role="radio"
            class="match-detail-timeline-metric"
            :class="{ 'match-detail-timeline-metric--active': metric === m.kind }"
            :aria-checked="metric === m.kind"
            @click="metric = m.kind"
          >
            {{ m.label }}
          </button>
        </div>

        <div class="match-detail-timeline-players">
          <button
            v-for="p in ctx.players.detailPlayers.value"
            :key="p.participantId"
            type="button"
            class="match-detail-timeline-player"
            :class="{
              'match-detail-timeline-player--active': selected.has(p.participantId),
              'match-detail-timeline-player--blue': p.teamId === 100,
              'match-detail-timeline-player--red': p.teamId === 200
            }"
            @click="togglePlayer(p.participantId)"
          >
            <span class="match-detail-timeline-player-dot" :style="{ background: teamColor(p) }" />
            {{ p.displayName }}
          </button>
          <button
            type="button"
            class="match-detail-timeline-player match-detail-timeline-player--all"
            @click="toggleAll"
          >
            {{ selected.size === ctx.players.detailPlayers.value.length ? '清空' : '全部' }}
          </button>
        </div>
      </div>

      <!-- 折线图 -->
      <svg
        class="match-detail-timeline-chart"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="`${metricLabel} 曲线`"
      >
        <!-- 网格线 -->
        <g v-for="line in gridLines" :key="line.y">
          <line
            :x1="PAD_L"
            :y1="line.y"
            :x2="W - PAD_R"
            :y2="line.y"
            class="match-detail-timeline-grid"
          />
          <text
            :x="PAD_L - 6"
            :y="line.y + 4"
            text-anchor="end"
            class="match-detail-timeline-axis-label"
          >
            {{ line.label }}
          </text>
        </g>

        <!-- 折线 -->
        <g v-for="p in visiblePlayers" :key="p.participantId">
          <polyline
            :points="polylinePoints(p.participantId)"
            :stroke="teamColor(p)"
            class="match-detail-timeline-line"
            :class="{ 'match-detail-timeline-line--fade': selected.size > 1 && !isMe(p) }"
          />
          <circle
            v-for="pt in pointsOf(p.participantId)"
            :key="pt.minute"
            :cx="xOf(pt.minute)"
            :cy="yOf(pt.value)"
            r="2"
            :fill="teamColor(p)"
            class="match-detail-timeline-dot"
          />
        </g>
      </svg>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { NSpin } from 'naive-ui'
import type { DetailPlayer } from '@renderer/composables/useMatchDetailPlayers'
import { matchDetailContextKey } from '../matchDetailContext'
import {
  TIMELINE_METRICS,
  buildTimelineSeries,
  fillSeries,
  type TimelineMetric,
  type TimelinePoint
} from './timelineData'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailTimelineTab 必须在 MatchDetailInline 容器内使用')
const ctx = injected as NonNullable<typeof injected>

onMounted(() => {
  void ctx.loadSgpDetail()
})

const loading = computed(
  () => ctx.sgpDetailStatus.value === 'loading' || ctx.sgpDetailStatus.value === 'idle'
)

const metric = ref<TimelineMetric>('gold')
const metricLabel = computed(
  () => TIMELINE_METRICS.find(m => m.kind === metric.value)?.label ?? '金币'
)

const series = computed(() => buildTimelineSeries(ctx.sgpDetail.value, metric.value))
const filled = computed(() => fillSeries(series.value.byParticipant, series.value.minutes))
const hasData = computed(() => ctx.sgpDetailStatus.value === 'ready' && series.value.frameCount > 0)

/** 默认选中"我"，无"我"则选第一人 */
const selected = ref<Set<number>>(new Set())
function ensureDefaultSelection() {
  if (selected.value.size > 0) return
  const me = ctx.players.detailPlayers.value.find(p => p.isMe)
  const first = ctx.players.detailPlayers.value[0]
  const target = me ?? first
  if (target) selected.value = new Set([target.participantId])
}
// 玩家列表就绪后初始化默认选中（防止 onMounted 时 detailPlayers 尚未填充）
watch(
  () => ctx.players.detailPlayers.value,
  () => ensureDefaultSelection(),
  { immediate: true }
)

function togglePlayer(pid: number) {
  const next = new Set(selected.value)
  if (next.has(pid)) next.delete(pid)
  else next.add(pid)
  if (next.size === 0 && ctx.players.detailPlayers.value.length) {
    // 保持至少一人选中，避免空图
    next.add(ctx.players.detailPlayers.value[0].participantId)
  }
  selected.value = next
}

function toggleAll() {
  const players = ctx.players.detailPlayers.value
  selected.value =
    selected.value.size === players.length
      ? new Set(players.length ? [players[0].participantId] : [])
      : new Set(players.map(p => p.participantId))
}

const isMe = (p: DetailPlayer) => p.isMe

const visiblePlayers = computed(() =>
  ctx.players.detailPlayers.value.filter(p => selected.value.has(p.participantId))
)

function teamColor(p: DetailPlayer) {
  if (p.teamId === 100) return '#4f8cff'
  if (p.teamId === 200) return '#ff5c5c'
  return '#b0b6c2'
}

// ── 坐标换算 ──

const W = 900
const H = 260
const PAD_L = 48
const PAD_R = 16
const PAD_T = 12
const PAD_B = 20

/** 分钟轴 → x（分钟满轴 + 左右边距，末分=1 时仍可画） */
function xOf(minute: number) {
  const n = series.value.minutes.length - 1
  const span = Math.max(1, n)
  return PAD_L + ((W - PAD_L - PAD_R) * minute) / span
}

/** 当前选中玩家中的最大值（折线定标） */
const maxValue = computed(() => {
  let max = 0
  for (const p of visiblePlayers.value) {
    for (const pt of filled.value[p.participantId] ?? []) max = Math.max(max, pt.value)
  }
  return max
})

/** 值 → y（0 底，最大值顶格） */
function yOf(value: number) {
  const span = Math.max(1, maxValue.value)
  return H - PAD_B - ((H - PAD_T - PAD_B) * value) / span
}

const pointsOf = (pid: number) => (filled.value[pid] ?? []) as TimelinePoint[]

const polylinePoints = (pid: number) =>
  pointsOf(pid)
    .map(pt => `${xOf(pt.minute).toFixed(1)},${yOf(pt.value).toFixed(1)}`)
    .join(' ')

/** 纵向网格线（约 5 条）+ y 轴标签 */
const gridLines = computed(() => {
  const lines: { y: number; label: string }[] = []
  const ticks = 5
  const step = Math.max(1, maxValue.value / ticks)
  for (let i = 0; i <= ticks; i++) {
    const value = Math.round(i * step)
    lines.push({ y: yOf(value), label: String(value) })
  }
  return lines
})
</script>

<style scoped>
.match-detail-timeline-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
  padding: var(--space-8) var(--space-12) var(--space-10);
}

.match-detail-timeline-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-20) var(--space-12);
  flex-direction: column;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.match-detail-timeline-state-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-timeline-state-desc {
  max-width: 420px;
  text-align: center;
  line-height: 1.6;
}

.match-detail-timeline-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
}

.match-detail-timeline-metrics {
  display: flex;
  gap: var(--space-4);
}

.match-detail-timeline-metric {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: transparent;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-8);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    background var(--dur-fast) var(--ease-expo);
}

.match-detail-timeline-metric:hover {
  color: var(--text-primary);
}

.match-detail-timeline-metric--active {
  color: var(--semantic-win-bright);
  border-color: color-mix(in srgb, var(--semantic-win) 55%, transparent);
  background: color-mix(in srgb, var(--semantic-win) 10%, transparent);
}

.match-detail-timeline-players {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.match-detail-timeline-player {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: transparent;
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-6);
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo),
    background var(--dur-fast) var(--ease-expo);
}

.match-detail-timeline-player:hover {
  color: var(--text-primary);
}

.match-detail-timeline-player--active {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--text-primary) 45%, transparent);
  background: color-mix(in srgb, var(--text-primary) 8%, transparent);
}

.match-detail-timeline-player--blue.match-detail-timeline-player--active {
  border-color: color-mix(in srgb, #4f8cff 60%, transparent);
  background: color-mix(in srgb, #4f8cff 14%, transparent);
}

.match-detail-timeline-player--red.match-detail-timeline-player--active {
  border-color: color-mix(in srgb, #ff5c5c 60%, transparent);
  background: color-mix(in srgb, #ff5c5c 14%, transparent);
}

.match-detail-timeline-player-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.match-detail-timeline-player--all {
  color: var(--text-tertiary);
}

.match-detail-timeline-chart {
  width: 100%;
  height: 260px;
  display: block;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg-elevated) 45%, transparent);
}

.match-detail-timeline-grid {
  stroke: var(--border-subtle);
  stroke-width: 1;
}

.match-detail-timeline-axis-label {
  fill: var(--text-tertiary);
  font-size: 10px;
}

.match-detail-timeline-line {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.match-detail-timeline-line--fade {
  opacity: 0.45;
}

.match-detail-timeline-dot {
  opacity: 0;
}

.match-detail-timeline-line--fade + .match-detail-timeline-dot {
  opacity: 0;
}
</style>
