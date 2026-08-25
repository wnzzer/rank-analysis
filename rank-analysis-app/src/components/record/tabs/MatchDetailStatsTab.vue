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
          <n-icon :size="14"><Search /></n-icon>
        </template>
      </n-input>
      <span class="match-detail-stats-count font-number">
        {{ visibleRows.length }} / {{ table.length }} 项
      </span>
    </div>

    <!-- 透视表：行 = 统计项，列 = 10 人；首列 + 表头双 sticky -->
    <div class="match-detail-stats-scroll">
      <!-- C-3-UI 出装对比行：10 人各 7 件 vs 该英雄推荐 7 件（PUGG），
           差异闪烁标注（黄=换装 / 红=乱出）；符文/技能并排。 -->
      <div
        v-if="!augmentMode && buildCells.length"
        class="match-detail-stats-row match-detail-stats-row--build"
      >
        <div class="match-detail-stats-label-cell">
          <span class="match-detail-stats-label">出装 vs 推荐</span>
          <span class="match-detail-build-legend">黄=换装 · 红=乱出</span>
        </div>
        <div class="match-detail-build-values">
          <n-tooltip
            v-for="(cell, i) in buildCells"
            :key="`build-${i}`"
            trigger="hover"
            placement="left"
          >
            <template #trigger>
              <div
                class="match-detail-build-cell"
                :class="[
                  `match-detail-build-cell--${cell.diff.overall}`,
                  `match-detail-build-cell--team-${cell.player.teamId}`
                ]"
              >
                <!-- 7 槽装备图标（skip 槽显示占位） -->
                <div class="match-detail-build-slots">
                  <span
                    v-for="(slot, slotIdx) in cell.diff.slots"
                    :key="slotIdx"
                    class="match-detail-build-slot"
                    :class="`match-detail-build-slot--${slot}`"
                  >
                    <img
                      v-if="ownedItemIds(cell.player)[slotIdx] > 0"
                      :src="ctx.assets.srcOf('item', ownedItemIds(cell.player)[slotIdx])"
                      class="match-detail-build-slot-img"
                      alt="item"
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                </div>
                <!-- 整体判定徽记 -->
                <span class="match-detail-build-verdict">{{ buildVerdictLabel(cell) }}</span>
              </div>
            </template>
            <template #default>
              <!-- 悬停详情：推荐 vs 实际，符文/技能并排 -->
              <div class="match-detail-build-tip">
                <div v-if="cell.recommend" class="match-detail-build-tip-sec">
                  <div class="match-detail-build-tip-title">推荐出装</div>
                  <div class="match-detail-build-tip-items">
                    <span
                      v-for="(rec, slotIdx) in cell.recommend"
                      :key="slotIdx"
                      class="match-detail-build-tip-item"
                    >
                      <img
                        v-if="rec"
                        :src="ctx.assets.srcOf('item', rec.itemId)"
                        class="match-detail-build-tip-img"
                        alt="item"
                      />
                      <span v-if="rec" class="match-detail-build-tip-name">
                        {{ itemName(rec.itemId) }}<i>×{{ rec.count > 0 ? rec.count : '' }}</i>
                      </span>
                      <span v-else class="match-detail-build-tip-name">—</span>
                    </span>
                  </div>
                </div>
                <div class="match-detail-build-tip-sec">
                  <div class="match-detail-build-tip-title">
                    实际出装（{{ cell.player.displayName }}）
                  </div>
                  <div class="match-detail-build-tip-items">
                    <span
                      v-for="(id, slotIdx) in ownedItemIds(cell.player)"
                      :key="slotIdx"
                      class="match-detail-build-tip-item"
                    >
                      <img
                        v-if="id > 0"
                        :src="ctx.assets.srcOf('item', id)"
                        class="match-detail-build-tip-img"
                        alt="item"
                      />
                      <span v-if="id > 0" class="match-detail-build-tip-name">
                        {{ itemName(id) }}
                      </span>
                    </span>
                  </div>
                </div>
                <div class="match-detail-build-tip-sec">
                  <div class="match-detail-build-tip-title">符文 / 召唤师技能</div>
                  <div class="match-detail-build-tip-icons">
                    <img
                      v-for="perkId in ctx.displayedPerkIds(cell.player.stats)"
                      :key="`perk-${perkId}`"
                      :src="ctx.assets.srcOf('perk', perkId)"
                      class="match-detail-build-tip-img"
                      :alt="`perk ${perkId}`"
                    />
                    <img
                      v-if="cell.player.spell1Id > 0"
                      :src="ctx.assets.srcOf('spell', cell.player.spell1Id)"
                      class="match-detail-build-tip-img"
                      alt="spell1"
                    />
                    <img
                      v-if="cell.player.spell2Id > 0"
                      :src="ctx.assets.srcOf('spell', cell.player.spell2Id)"
                      class="match-detail-build-tip-img"
                      alt="spell2"
                    />
                  </div>
                </div>
                <div v-if="buildLoading" class="match-detail-build-tip-na">推荐数据加载中…</div>
                <div v-else-if="!cell.recommend" class="match-detail-build-tip-na">
                  该英雄暂无本队推荐样本（样本 ≥5 场才出推荐）
                </div>
              </div>
            </template>
          </n-tooltip>
        </div>
      </div>

      <div v-for="group in ALL_GROUPS" :key="group" class="match-detail-stats-group">
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
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import { NIcon, NInput, NTooltip } from 'naive-ui'
import { matchDetailContextKey } from '../matchDetailContext'
import {
  STAT_GROUPS,
  buildStatsTable,
  buildCompareRow,
  filterStatsRows,
  type StatsTablePlayer,
  type StatsTableRow,
  type BuildCompareCell
} from './detailsTable'
import { getBuildStats } from '@renderer/services/builds'
import type { ItemStat } from '@renderer/services/builds'
import { buildSgpFrameRows, aggregateSgpFrameStats, SGP_FRAME_GROUP } from './sgpFrameStats'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailStatsTab 必须在 MatchDetailInline 容器内使用')
const ctx = injected as NonNullable<typeof injected>

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
      spell1Id: p.spell1Id,
      spell2Id: p.spell2Id,
      stats: p.stats
    }))
)

/** SGP 帧流行：仅 SGP 详情就绪时并入（LCU 模式 sgpDetailStatus 恒 idle，不显示） */
const sgpFrameRows = computed<StatsTableRow[]>(() =>
  ctx.sgpDetailStatus.value === 'ready'
    ? buildSgpFrameRows(players.value, aggregateSgpFrameStats(ctx.sgpDetail.value))
    : []
)

const table = computed(() => [...buildStatsTable(players.value), ...sgpFrameRows.value])

/** 展示组序：基础 6 组 + SGP 帧流（末尾） */
const ALL_GROUPS = [...STAT_GROUPS, SGP_FRAME_GROUP]

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
  for (const group of ALL_GROUPS) map[group] = []
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

// ── C-3-UI 出装对比行：10 人 7 件 vs 该英雄推荐 7 件（PUGG）──

/** 海克斯/斗魂模式无传统出装（强化槽取代），该行不适用 */
const augmentMode = computed(() => ctx.usesAugments.value)

/** currentSummary（"我"）的 puuid：PUGG 口径与对局中卡片一致（自有历史聚合） */
const myPuuid = computed(() => ctx.players.mySummary.value?.puuid ?? '')

/** 英雄 id → 推荐 7 槽（ItemStat[] = PUGG 聚合去重净胜权重后的 top1；null = 无样本/失败） */
const recommendByChampion = ref(new Map<number, (ItemStat | null)[] | null>())
const buildLoading = ref(false)

/** 出装对比行单元格（列序与 players 一致） */
const buildCells = computed<BuildCompareCell[]>(() =>
  buildCompareRow(players.value, s => ctx.itemIds(s), recommendByChampion.value)
)

/** 玩家实际 7 槽装备 id（与 diff.slots 索引一一对应） */
function ownedItemIds(player: StatsTablePlayer): number[] {
  return ctx.itemIds(player.stats)
}

function itemName(id: number): string {
  return ctx.assets.detailOf('item', id)?.name ?? `装备 #${id}`
}

function buildVerdictLabel(cell: BuildCompareCell): string {
  switch (cell.diff.overall) {
    case 'match':
      return '一致'
    case 'swap':
      return '换装'
    case 'odd':
      return '乱出'
    default:
      return '—'
  }
}

/** 每局加载一次：10 人的英雄集合去重后逐英雄拉 PUGG（Rust 侧 moka 缓存命中） */
async function loadBuildRecommendations() {
  const puuid = myPuuid.value
  if (!puuid || augmentMode.value) return

  const champions = [...new Set(players.value.map(p => p.championId).filter(id => id > 0))]
  if (!champions.length) return

  const mode = ctx.game.value?.queueId ?? 0
  buildLoading.value = true
  try {
    const jobs = champions.map(async championId => {
      // 已有结果（含 null = 无样本，不再重试）直接跳过
      if (recommendByChampion.value.has(championId)) return
      const build = await getBuildStats(puuid, championId, mode)
      const slots: (ItemStat | null)[] | null = build
        ? build.items.map(slot => slot[0] ?? null)
        : null
      recommendByChampion.value = new Map(recommendByChampion.value).set(championId, slots)
    })
    await Promise.all(jobs)
  } finally {
    buildLoading.value = false
  }
}

/** "我"切换（段位后进/换队）或对局切换时重算推荐 */
watch([myPuuid, augmentMode], () => {
  recommendByChampion.value = new Map()
  void loadBuildRecommendations()
})

onMounted(() => {
  void loadBuildRecommendations()
})
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

/* ── C-3-UI 出装对比行 ── */
.match-detail-build-legend {
  display: block;
  margin-top: var(--space-2);
  font-size: var(--font-size-2xs);
  font-weight: 400;
  color: var(--text-tertiary);
  white-space: normal;
}

.match-detail-build-values {
  display: grid;
  grid-template-columns: repeat(10, minmax(64px, 1fr));
  flex: 1;
}

.match-detail-build-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
  border-right: 1px solid color-mix(in srgb, var(--border-subtle) 40%, transparent);
}

.match-detail-build-cell:last-child {
  border-right: none;
}

/* 队伍色牌：与数值列同口径 */
.match-detail-build-cell--team-100 {
  box-shadow: inset 3px 0 0 0 var(--accent-blue);
}

.match-detail-build-cell--team-200 {
  box-shadow: inset 3px 0 0 0 var(--semantic-loss);
}

/* 整体判定底色（黄=换装 / 红=乱出 闪烁强调；一致/暂无不强调） */
.match-detail-build-cell--swap,
.match-detail-build-cell--odd {
  animation: build-verdict-flash 2.4s ease-in-out infinite;
}

.match-detail-build-cell--swap {
  background: color-mix(in srgb, var(--semantic-warn) 10%, transparent);
}

.match-detail-build-cell--odd {
  background: color-mix(in srgb, var(--semantic-loss) 12%, transparent);
}

@keyframes build-verdict-flash {
  0%,
  55% {
    opacity: 1;
  }
  60%,
  100% {
    opacity: 0.62;
  }
}

.match-detail-build-slots {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  width: 100%;
}

.match-detail-build-slot {
  display: inline-flex;
  aspect-ratio: 1;
  border-radius: var(--radius-xs);
  background: var(--glass-bg-mid);
}

/* 槽位差异色：黄=换装，红=乱出；skip 为占位不发色 */
.match-detail-build-slot--swap {
  outline: 1.5px solid var(--semantic-warn);
  outline-offset: -1px;
}

.match-detail-build-slot--odd {
  outline: 1.5px solid var(--semantic-loss);
  outline-offset: -1px;
}

.match-detail-build-slot-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

.match-detail-build-verdict {
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.match-detail-build-cell--swap .match-detail-build-verdict {
  color: var(--semantic-warn);
}

.match-detail-build-cell--odd .match-detail-build-verdict {
  color: var(--semantic-loss);
}

/* 悬停详情：推荐 vs 实际，符文/技能并排 */
.match-detail-build-tip {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 240px;
}

.match-detail-build-tip-sec {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.match-detail-build-tip-title {
  font-size: var(--font-size-2xs);
  font-weight: 700;
  color: var(--text-tertiary);
}

.match-detail-build-tip-items {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}

.match-detail-build-tip-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.match-detail-build-tip-img {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-xs);
  flex-shrink: 0;
}

.match-detail-build-tip-icons {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

.match-detail-build-tip-name {
  font-size: var(--font-size-2xs);
  color: var(--text-primary);
  white-space: nowrap;
}

.match-detail-build-tip-name i {
  margin-left: var(--space-2);
  font-style: normal;
  color: var(--text-tertiary);
}

.match-detail-build-tip-na {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
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
