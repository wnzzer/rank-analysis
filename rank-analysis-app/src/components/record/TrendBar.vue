<template>
  <div v-if="games.length > 0" class="trend-bar">
    <span class="trend-bar-title">近{{ games.length }}场趋势</span>
    <div class="trend-bar-cells" role="list" aria-label="近期对局趋势">
      <n-tooltip
        v-for="game in games"
        :key="game.gameId"
        trigger="hover"
        placement="top"
        class="trend-bar-cell-wrap"
      >
        <template #trigger>
          <span
            class="trend-bar-cell"
            :class="game.participants[0].stats.win ? 'trend-bar-cell-win' : 'trend-bar-cell-loss'"
            :style="{ width: cellWidth(game) }"
            role="listitem"
            tabindex="0"
            @click="emit('select-game', game.gameId)"
            @keyup.enter="emit('select-game', game.gameId)"
          >
            <span
              v-if="game.mvp"
              class="trend-bar-mvp-dot"
              :class="game.mvp === 'MVP' ? 'trend-bar-mvp-gold' : 'trend-bar-mvp-silver'"
            />
            <span class="trend-bar-death-cells" :class="deathCellClass(game)">
              <span v-for="i in deathCellCount(game)" :key="i" class="trend-bar-death-cell" />
            </span>
          </span>
        </template>
        <span class="trend-bar-tooltip-line">
          {{ tooltipDate(game) }} · {{ championName(game) }}
        </span>
        <span class="trend-bar-tooltip-line font-number">
          {{ tooltipKda(game) }}
        </span>
      </n-tooltip>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { NTooltip } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import type { championOption } from '@renderer/types/domain/champion'

const props = withDefaults(
  defineProps<{
    /** 已过滤的对局列表（时间降序：新 → 旧） */
    games: Game[]
    championOptions?: championOption[]
  }>(),
  { championOptions: () => [] }
)

const emit = defineEmits<{
  'select-game': [gameId: number]
}>()

/** 格宽 = 时长归一化（10-60 分钟 → 4-24px），最短 4px 保证可点击 */
const cellWidth = (game: Game) => {
  const minutes = game.gameDuration / 60
  const clamped = Math.min(60, Math.max(10, minutes))
  const width = 4 + ((clamped - 10) / 50) * 20
  return `${Math.round(width * 10) / 10}px`
}

/** 死亡暗格数：1 死亡即 1 格，最多 4 格（>4 不再加深，避免高死亡局糊成黑块） */
const deathCellCount = (game: Game) => {
  const deaths = game.participants[0]?.stats?.deaths ?? 0
  return Math.min(4, Math.max(1, deaths))
}

/** 死亡太多时整格压暗一档（视觉语言：暗格 = 死亡） */
const deathCellClass = (game: Game) => {
  const deaths = game.participants[0]?.stats?.deaths ?? 0
  if (deaths >= 10) return 'trend-bar-death-cells-heavy'
  return ''
}

const championName = (game: Game) => {
  const id = game.participants[0].championId
  return props.championOptions.find(option => option.value === id)?.label ?? `英雄 ${id}`
}

const tooltipDate = (game: Game) => new Date(game.gameCreationDate).toLocaleString()

const tooltipKda = (game: Game) => {
  const s = game.participants[0]?.stats
  if (!s) return ''
  return `${s.kills}/${s.deaths}/${s.assists}`
}
</script>

<style scoped>
.trend-bar {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  min-height: 32px;
  padding: var(--space-4) var(--space-12);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm), var(--glass-highlight);
  overflow-x: auto;
  scrollbar-width: none;
}

.trend-bar::-webkit-scrollbar {
  display: none;
}

.trend-bar-title {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.trend-bar-cells {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.trend-bar-cell {
  position: relative;
  height: 20px;
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    transform var(--dur-fast) var(--ease-expo),
    filter var(--dur-fast) var(--ease-expo);
}

.trend-bar-cell:hover,
.trend-bar-cell:focus-visible {
  transform: translateY(-2px);
  filter: brightness(1.2);
  outline: none;
}

.trend-bar-cell-win {
  background: linear-gradient(180deg, #2f9e63, #1f7a4c);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.trend-bar-cell-loss {
  background: linear-gradient(180deg, #c74b5c, #a13544);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

/* 死亡暗格：格内底部一排小暗格，数量 = 死亡数（≤4） */
.trend-bar-death-cells {
  display: inline-flex;
  gap: 1px;
  align-items: flex-end;
  height: 8px;
}

.trend-bar-death-cell {
  width: 3px;
  height: 4px;
  border-radius: 1px;
  background: rgba(0, 0, 0, 0.55);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.trend-bar-death-cells-heavy .trend-bar-death-cell {
  background: rgba(0, 0, 0, 0.78);
}

/* MVP/SVP 绿点（金/银）：顶部居中，越界压格 */
.trend-bar-mvp-dot {
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.trend-bar-mvp-gold {
  background: linear-gradient(180deg, #f6d365, #d4a017);
  box-shadow: 0 0 4px rgba(244, 198, 88, 0.6);
}

.trend-bar-mvp-silver {
  background: linear-gradient(180deg, #eef3f9, #aab8c8);
  box-shadow: 0 0 4px rgba(190, 205, 222, 0.5);
}

.trend-bar-tooltip-line {
  display: block;
  font-size: var(--font-size-xs);
}
</style>
