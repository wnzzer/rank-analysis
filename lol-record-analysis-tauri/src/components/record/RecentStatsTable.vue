<template>
  <n-card
    class="record-panel-card recent-stats-card"
    :bordered="false"
    size="small"
    content-style="padding: 12px"
  >
    <n-flex justify="space-between" align="center" class="recent-stats-header">
      <span class="recent-stats-title">最近表现</span>
      <n-dropdown
        trigger="hover"
        :options="modeOptions"
        :on-select="(value: string | number, option: any) => emit('mode-change', value, option)"
        :show-arrow="false"
      >
        <n-button round size="tiny" secondary type="primary">{{ mode }}</n-button>
      </n-dropdown>
    </n-flex>

    <n-flex vertical class="recent-stats-rows">
      <!-- KDA -->
      <div class="stat-row">
        <div class="stat-label-group">
          <n-icon class="stat-icon-kda"><PulseOutline /></n-icon>
          <span>KDA</span>
        </div>
        <!-- KDA 没有 raw-value 维度,不占左占位,让 KDA + 击杀详情有更宽空间 -->
        <div class="stat-value-group stat-kda-value-wrap">
          <span class="stat-kda-main" :style="{ color: kdaColor(recentData.kda, isDark) }">
            {{ recentData.kda }}
          </span>
          <span class="kda-detail">
            <span :style="{ color: killsColor(recentData.kills, isDark) }">
              {{ recentData.kills }}
            </span>
            /
            <span :style="{ color: deathsColor(recentData.deaths, isDark) }">
              {{ recentData.deaths }}
            </span>
            /
            <span :style="{ color: assistsColor(recentData.assists, isDark) }">
              {{ recentData.assists }}
            </span>
          </span>
        </div>
      </div>

      <!-- Win Rate -->
      <ProgressStatRow
        label="胜率"
        :percent="winRate(recentData.selectWins, recentData.selectLosses)"
        :color="winRateColor(winRate(recentData.selectWins, recentData.selectLosses), isDark)"
      />
      <!-- Participation -->
      <ProgressStatRow
        :percent="recentData.groupRate"
        :color="groupRateColor(recentData.groupRate, isDark)"
      >
        <template #label>
          <n-icon><AccessibilityOutline /></n-icon> 参团率
        </template>
      </ProgressStatRow>
      <!-- Damage -->
      <ProgressStatRow
        label="伤害"
        :raw-value="recentData.averageDamageDealtToChampions"
        :percent="recentData.damageDealtToChampionsRate"
        :color="otherColor(recentData.damageDealtToChampionsRate, isDark)"
      />
      <!-- Gold -->
      <ProgressStatRow
        label="经济"
        :raw-value="recentData.averageGold"
        :percent="recentData.goldRate"
        :color="otherColor(recentData.goldRate, isDark)"
      />
    </n-flex>
  </n-card>
</template>

<script setup lang="ts">
import { AccessibilityOutline, PulseOutline } from '@vicons/ionicons5'
import { NCard, NFlex, NDropdown, NButton, NIcon } from 'naive-ui'
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
import { modeOptions } from '@renderer/composables/useGameModes'
import ProgressStatRow from './ProgressStatRow.vue'

defineProps<{
  recentData: RecentData
  mode: string
  isDark: boolean
}>()

const emit = defineEmits<{
  'mode-change': [value: string | number, option: any]
}>()
</script>

<style scoped>
.recent-stats-header {
  margin-bottom: var(--space-12);
}

.recent-stats-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.recent-stats-rows {
  gap: var(--space-8);
}

.stat-row {
  display: flex;
  align-items: center;
  font-size: 13px;
  min-height: 28px;
}

.stat-label-group {
  /* 收紧到 60px 给右侧 KDA / progress / raw-value 让出 20px 空间 */
  width: 60px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  font-weight: 500;
  gap: 6px;
}

.stat-value-group {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

.stat-kda-value-wrap {
  /* KDA 行只有"主值 + K/D/A 详情"两个块,左右贴边对齐,跟其它行的 progress 风格不同。 */
  justify-content: space-between;
  white-space: nowrap;
  min-width: 0;
  padding: 0 6px;
}

.stat-kda-main {
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.02em;
}

.kda-detail {
  /* margin-left 被 space-between 替代 */
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}

.stat-center-content {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 6px;
}

.raw-value {
  width: 52px;
  text-align: right;
  margin-right: 8px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  font-size: 13px;
}

.stat-icon-kda {
  color: var(--semantic-win);
  font-size: 16px;
}
</style>
