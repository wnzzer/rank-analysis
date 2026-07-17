<template>
  <div class="stats-container">
    <div class="stats-card" :class="{ 'is-expanded': showStats }">
      <!-- Header / Toggle -->
      <div class="stats-header" @click="showStats = !showStats">
        <span class="stats-title">近期数据</span>
        <n-icon size="14" class="toggle-icon">
          <chevron-down v-if="!showStats" />
          <chevron-up v-else />
        </n-icon>
      </div>

      <!-- Compact Content -->
      <!-- 该模式 0 场时显示中性「暂无」——0 红字会被误读成惨烈战绩（实际是没打过） -->
      <div v-if="!showStats" class="stats-compact" @click="showStats = true">
        <div class="compact-row">
          <span class="label">模式</span>
          <span class="value">{{ recent.selectModeCn }}</span>
        </div>
        <div class="compact-row">
          <span class="label">KDA</span>
          <span
            class="value"
            :style="hasGames ? { color: kdaColor(recent.kda, isDark) } : undefined"
          >
            {{ hasGames ? recent.kda : '—' }}
          </span>
        </div>
        <div class="compact-row">
          <span class="label">胜率</span>
          <span
            class="value"
            :style="hasGames ? { color: winRateColor(selectWinRate, isDark) } : undefined"
          >
            {{ hasGames ? `${selectWinRate}%` : '暂无' }}
          </span>
        </div>
      </div>

      <!-- Expanded Content -->
      <div v-else class="stats-full">
        <div class="stats-row">
          <span class="label">模式</span>
          <span class="value value-strong">{{ recent.selectModeCn }}</span>
        </div>
        <div class="stats-row">
          <span class="label">KDA</span>
          <div class="value-group">
            <span class="kda-main" :style="{ color: kdaColor(recent.kda, isDark) }">
              {{ recent.kda }}
            </span>
            <span class="kda-detail">
              <span :style="{ color: killsColor(recent.kills, isDark) }">{{ recent.kills }}</span
              >/
              <span :style="{ color: deathsColor(recent.deaths, isDark) }">{{ recent.deaths }}</span
              >/
              <span :style="{ color: assistsColor(recent.assists, isDark) }">{{
                recent.assists
              }}</span>
            </span>
          </div>
        </div>
        <ProgressMiniRow
          label="胜率"
          :percent="selectWinRate"
          :color="winRateColor(selectWinRate, isDark)"
        />
        <ProgressMiniRow
          label="参团"
          :percent="recent.groupRate"
          :color="groupRateColor(recent.groupRate, isDark)"
        />
        <ProgressMiniRow
          label="伤害"
          :percent="recent.damageDealtToChampionsRate"
          :color="otherColor(recent.damageDealtToChampionsRate, isDark)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NIcon } from 'naive-ui'
import { ChevronDown, ChevronUp } from '@vicons/ionicons5'
import type { RecentData } from '@renderer/types/domain/analysis'
import {
  kdaColor,
  killsColor,
  deathsColor,
  assistsColor,
  winRateColor,
  groupRateColor,
  otherColor
} from '@renderer/utils/colors'
import { winRate } from '@renderer/utils/rank'
import ProgressMiniRow from './ProgressMiniRow.vue'

const props = defineProps<{
  recent: RecentData
  isDark: boolean
}>()

const showStats = ref(false)

const selectWinRate = computed(() => winRate(props.recent.selectWins, props.recent.selectLosses))

/** 当前统计模式下是否打过对局：0 场时 KDA/胜率显示中性占位而非红色 0 */
const hasGames = computed(
  () => (props.recent.selectWins ?? 0) + (props.recent.selectLosses ?? 0) > 0
)
</script>

<style scoped>
.stats-container {
  position: relative;
}

.stats-card {
  background: var(--glass-bg-low);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  transition:
    background var(--dur-normal) var(--ease-expo),
    border-color var(--dur-normal) var(--ease-expo),
    box-shadow var(--dur-normal) var(--ease-expo);
  border: 1px solid var(--glass-border);
}

.stats-card.is-expanded {
  position: absolute;
  top: 0;
  right: 0;
  /* 240px: 展开态固定宽度，避免抖动 */
  width: 240px;
  z-index: 100;
  background: var(--bg-elevated);
  border-color: color-mix(in srgb, var(--semantic-win) 25%, transparent);
  /* 外圈 2px 底色"暗缝"把浮层从下方内容里切出来，再叠常规投影 */
  box-shadow:
    0 0 0 2px var(--bg-base),
    var(--shadow-lg);
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--n-divider-color);
}

.stats-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--n-text-color-2);
}

.toggle-icon {
  opacity: 0.7;
}

.stats-compact {
  cursor: pointer;
}

.compact-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  margin-bottom: var(--space-2);
}

.stats-full {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-top: var(--space-4);
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
}

.label {
  color: var(--n-text-color-3);
}

.value-strong {
  font-weight: 600;
}

.value-group {
  display: flex;
  align-items: center;
}

.kda-main {
  font-weight: bold;
  margin-right: var(--space-4);
}

.kda-detail {
  font-size: var(--font-size-xs);
  opacity: 0.9;
  margin-left: var(--space-4);
}
</style>
