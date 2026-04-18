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
      <div v-if="!showStats" class="stats-compact" @click="showStats = true">
        <div class="compact-row">
          <span class="label">模式</span>
          <span class="value">{{ recent.selectModeCn }}</span>
        </div>
        <div class="compact-row">
          <span class="label">KDA</span>
          <span class="value" :style="{ color: kdaColor(recent.kda, isDark) }">
            {{ recent.kda }}
          </span>
        </div>
        <div class="compact-row">
          <span class="label">胜率</span>
          <span class="value" :style="{ color: winRateColor(selectWinRate, isDark) }">
            {{ selectWinRate }}%
          </span>
        </div>
      </div>

      <!-- Expanded Content -->
      <div v-else class="stats-full">
        <div class="stats-row">
          <span class="label">模式</span>
          <span class="value" style="font-weight: 600">{{ recent.selectModeCn }}</span>
        </div>
        <div class="stats-row">
          <span class="label">KDA</span>
          <div class="value-group">
            <span
              :style="{ color: kdaColor(recent.kda, isDark) }"
              style="font-weight: bold; margin-right: 4px"
            >
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
</script>

<style scoped>
.stats-container {
  position: relative;
}

.stats-card {
  background: var(--glass-bg-low);
  border-radius: var(--radius-md);
  padding: 6px;
  transition: all var(--dur-normal) var(--ease-expo);
  border: 1px solid var(--glass-border);
}

.stats-card.is-expanded {
  position: absolute;
  top: 0;
  right: 0;
  width: 240px;
  z-index: 100;
  background: var(--bg-elevated);
  border-color: rgba(61, 155, 122, 0.25);
  box-shadow: var(--shadow-lg);
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--n-divider-color);
}

.stats-title {
  font-size: 11px;
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
  font-size: 11px;
  margin-bottom: 2px;
}

.stats-full {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.label {
  color: var(--n-text-color-3);
}

.value-group {
  display: flex;
  align-items: center;
}

.kda-detail {
  font-size: 11px;
  opacity: 0.9;
  margin-left: 4px;
}
</style>
