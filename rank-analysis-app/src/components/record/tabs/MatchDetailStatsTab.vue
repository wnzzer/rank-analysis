<template>
  <div class="match-detail-stats-tab">
    <!-- 行过滤：按统计名/key 过滤，debounce 250ms -->
    <div class="match-detail-stats-filter">
      <n-input
        v-model:value="keyword"
        size="small"
        placeholder="过滤统计项（如：击杀 / damage）"
        clearable
        @update:value="scheduleFilter"
      >
        <template #prefix>
          <n-icon :size="14"><SearchOutline /></n-icon>
        </template>
      </n-input>
      <span class="match-detail-stats-count font-number">
        {{ visibleRows.length }} / {{ table.length }} 项
      </span>
    </div>

    <!-- 透视表：行 = 统计项，列 = 10 人；首列 + 表头双 sticky -->
    <div class="match-detail-stats-scroll">
      <div v-for="group in STAT_GROUPS" :key="group" class="match-detail-stats-group">
        <div v-if="groupedRows[group].length" class="match-detail-stats-group-title">
          {{ group }}
        </div>
        <div
          v-for="row in groupedRows[group]"
          :key="row.def.key"
          class="match-detail-stats-row"
          :class="{ 'match-detail-stats-row--missing': row.max === 0 }"
        >
          <!-- 首列：统计名（sticky left） -->
          <div class="match-detail-stats-label-cell">
            <span class="match-detail-stats-label">{{ row.def.label }}</span>
          </div>
          <!-- 数据列：10 人 -->
          <n-tooltip
            v-if="row.max > 0"
            trigger="hover"
            placement="left"
            :disabled="statsBarDisabled(row)"
          >
            <template #trigger>
              <div class="match-detail-stats-values">
                <span
                  v-for="(v, i) in row.values"
                  :key="`${row.def.key}-${i}`"
                  class="match-detail-stats-cell font-number"
                  :class="{
                    'match-detail-stats-cell--best': v === row.max && !Number.isNaN(v),
                    [`match-detail-stats-cell--team-${players[i]?.teamId ?? 0}`]: true
                  }"
                  >{{ formatCell(row, v) }}</span
                >
              </div>
            </template>
            <template #default>
              <div class="match-detail-stats-bars">
                <div
                  v-for="(p, i) in players"
                  :key="p.participantId"
                  class="match-detail-stats-bar-row"
                >
                  <span class="match-detail-stats-bar-name">{{ p.displayName }}</span>
                  <span class="match-detail-stats-bar-track">
                    <span
                      class="match-detail-stats-bar-fill"
                      :class="`match-detail-stats-bar-fill--team-${p.teamId}`"
                      :style="{
                        width: barWidth(row.values[i], row.max)
                      }"
                    />
                  </span>
                  <span class="match-detail-stats-bar-value font-number">{{
                    formatCell(row, row.values[i])
                  }}</span>
                </div>
              </div>
            </template>
          </n-tooltip>
          <div v-else class="match-detail-stats-values">
            <span
              v-for="i in row.values.length"
              :key="`${row.def.key}-${i}`"
              class="match-detail-stats-cell match-detail-stats-cell--na font-number"
              >—</span
            >
          </div>
        </div>
      </div>
    </div>

    <div v-if="visibleRows.length === 0" class="match-detail-stats-empty">
      没有匹配「{{ keyword }}」的统计项
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { SearchOutline } from '@vicons/ionicons5'
import { NIcon, NInput, NTooltip } from 'naive-ui'
import { matchDetailContextKey } from '../matchDetailContext'
import {
  STAT_GROUPS,
  buildStatsTable,
  filterStatsRows,
  type StatsTablePlayer,
  type StatsTableRow
} from './detailsTable'

const ctx = inject(matchDetailContextKey)
if (!ctx) throw new Error('MatchDetailStatsTab 必须在 MatchDetailInline 容器内使用')

/** 列序：蓝队（100）→ 红队（200），与战绩页队伍分节一致 */
const players = computed<StatsTablePlayer[]>(() =>
  [...ctx.players.detailPlayers.value]
    .sort((a, b) => a.teamId - b.teamId || a.participantId - b.participantId)
    .map(p => ({
      index: p.participantId,
      participantId: p.participantId,
      teamId: p.teamId,
      displayName: p.displayName,
      championId: p.championId,
      win: p.win,
      stats: p.stats
    }))
)

const table = computed(() => buildStatsTable(players.value))

/** 行过滤：debounce 250ms（LCU 版仅名称过滤） */
const keyword = ref('')
const debouncedKeyword = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | undefined
function scheduleFilter() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedKeyword.value = keyword.value
  }, 250)
}
onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

const visibleRows = computed(() => filterStatsRows(table.value, debouncedKeyword.value))

const groupedRows = computed<Record<string, StatsTableRow[]>>(() => {
  const map: Record<string, StatsTableRow[]> = {}
  for (const group of STAT_GROUPS) map[group] = []
  for (const row of visibleRows.value) map[row.def.group].push(row)
  return map
})

function formatCell(row: StatsTableRow, value: number) {
  if (Number.isNaN(value)) return '—'
  return row.def.format(value)
}

/** 单列数值的 hover 条形图只对数值型行提供；缺失行（max 0）不挂 tooltip */
function statsBarDisabled(row: StatsTableRow) {
  return row.max === 0 || row.values.every(v => Number.isNaN(v))
}

/** 条形宽度：按行 max 刻度，0/NaN 时 0% */
function barWidth(value: number, max: number) {
  if (Number.isNaN(value) || max <= 0) return '0%'
  return `${Math.max(2, Math.round((value / max) * 100))}%`
}
</script>

<style scoped>
.match-detail-stats-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12) var(--space-10);
}

.match-detail-stats-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}

.match-detail-stats-filter .n-input {
  max-width: 300px;
}

.match-detail-stats-count {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

/* 横向滚动容器：表头 + 首列 sticky 的定位上下文 */
.match-detail-stats-scroll {
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.015);
}

.theme-light .match-detail-stats-scroll {
  background: var(--bg-elevated);
}

.match-detail-stats-group {
  display: flex;
  flex-direction: column;
}

.match-detail-stats-group + .match-detail-stats-group {
  border-top: 1px solid var(--border-subtle);
}

.match-detail-stats-group-title {
  position: sticky;
  left: 0;
  padding: var(--space-6) var(--space-12);
  font-size: var(--font-size-2xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  background: var(--glass-bg-low);
}

.match-detail-stats-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
}

.match-detail-stats-row:last-child {
  border-bottom: none;
}

.match-detail-stats-row:hover {
  background: var(--glass-bg-mid);
}

/* 首列：sticky left，z 高于数据列 */
.match-detail-stats-label-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 140px;
  padding: var(--space-6) var(--space-12);
  background: var(--glass-bg-low);
  border-right: 1px solid var(--border-subtle);
}

.match-detail-stats-label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.match-detail-stats-values {
  display: grid;
  grid-template-columns: repeat(10, minmax(64px, 1fr));
  flex: 1;
}

.match-detail-stats-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: var(--space-6) var(--space-8);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  border-right: 1px solid color-mix(in srgb, var(--border-subtle) 40%, transparent);
  font-variant-numeric: tabular-nums;
}

.match-detail-stats-cell:last-child {
  border-right: none;
}

/* 队伍色条：左侧 2px 队伍色标签（蓝/红），一眼区分两队在 10 列里的分界 */
.match-detail-stats-cell--team-100 {
  box-shadow: inset 3px 0 0 0 var(--accent-blue);
}

.match-detail-stats-cell--team-200 {
  box-shadow: inset 3px 0 0 0 var(--semantic-loss);
}

/* 全场最高值高亮 */
.match-detail-stats-cell--best {
  color: var(--accent-gold);
  font-weight: 700;
}

.match-detail-stats-cell--na {
  color: var(--text-tertiary);
}

/* hover 条形图：10 人横向对比 */
.match-detail-stats-bars {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 260px;
}

.match-detail-stats-bar-row {
  display: grid;
  grid-template-columns: 88px 1fr 64px;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-stats-bar-name {
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-detail-stats-bar-track {
  height: 6px;
  border-radius: var(--radius-xs);
  background: var(--glass-bg-mid);
  overflow: hidden;
}

.match-detail-stats-bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-xs);
  transition: width var(--dur-normal) var(--ease-expo);
}

.match-detail-stats-bar-fill--team-100 {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent-blue) 55%, transparent),
    var(--accent-blue)
  );
}

.match-detail-stats-bar-fill--team-200 {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--semantic-loss) 55%, transparent),
    var(--semantic-loss)
  );
}

.match-detail-stats-bar-value {
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.match-detail-stats-empty {
  padding: var(--space-16);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
</style>
