<template>
  <n-card class="record-panel-card panel-glass" :bordered="false" size="small">
    <n-flex vertical :size="10">
      <n-flex justify="space-between" align="center">
        <span class="trend-title">近 20 场趋势</span>
        <span class="trend-mode">
          {{ recentData.selectModeCn || mode }} ·
          <span class="font-number">{{ recentData.samples ?? 0 }}</span> 场样本
        </span>
      </n-flex>

      <!-- 数据不足：后端聚合无样本时不展示指标，明示原因 -->
      <n-flex v-if="hasSamples" :wrap="true" :size="8" class="trend-grid">
        <div class="trend-cell">
          <span class="trend-label">胜率</span>
          <span
            class="font-number trend-value"
            :style="{ color: winRateColor(winRateNum, isDark) }"
          >
            {{ winRateNum }}%
          </span>
        </div>
        <div class="trend-cell">
          <span class="trend-label">KDA</span>
          <span
            class="font-number trend-value"
            :style="{ color: kdaColor(recentData.kda, isDark) }"
          >
            {{ recentData.kda }}
          </span>
        </div>
        <div class="trend-cell">
          <span class="trend-label">参团率</span>
          <span
            class="font-number trend-value"
            :style="{ color: groupRateColor(recentData.groupRate, isDark) }"
          >
            {{ recentData.groupRate }}%
          </span>
        </div>
        <div class="trend-cell">
          <span class="trend-label">补刀/分钟</span>
          <span class="font-number trend-value">{{ recentData.averageCsPerMin.toFixed(1) }}</span>
        </div>
        <div class="trend-cell">
          <span class="trend-label">视野得分</span>
          <span class="font-number trend-value">{{
            recentData.averageVisionScore.toFixed(1)
          }}</span>
        </div>
        <div class="trend-cell">
          <span class="trend-label">平均经济</span>
          <span class="font-number trend-value">
            {{ Math.round(recentData.averageGold / 1000) }}k
          </span>
        </div>
      </n-flex>
      <n-text v-else depth="3" class="trend-empty">近 20 场暂无有效样本（对局数据不足）</n-text>

      <!-- AI 成长报告 -->
      <n-flex align="center" justify="space-between">
        <span class="trend-ai-label">AI 成长报告</span>
        <n-button
          size="tiny"
          secondary
          type="primary"
          :loading="loading"
          :disabled="!hasSamples"
          @click="onGenerate"
        >
          {{ result ? '重新生成' : '生成报告' }}
        </n-button>
      </n-flex>
      <div v-if="result" class="ai-growth-content" v-html="renderedResult"></div>
    </n-flex>
  </n-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NButton, NFlex, NText } from 'naive-ui'
import type { RecentData } from '@renderer/types/domain/analysis'
import { kdaColor, winRateColor, groupRateColor } from '@renderer/utils/colors'
import { winRate } from '@renderer/utils/rank'
import { useGrowthReport } from '@renderer/composables/useGrowthReport'

const props = defineProps<{
  recentData: RecentData
  mode: string
  isDark: boolean
}>()

const { loading, result, renderedResult, generate } = useGrowthReport()

const hasSamples = computed(() => (props.recentData.samples ?? 0) > 0)
const winRateNum = computed(() =>
  winRate(props.recentData.selectWins, props.recentData.selectLosses)
)

const onGenerate = () => generate(props.recentData)
</script>

<style scoped>
.trend-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.trend-mode {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

.trend-grid {
  display: flex;
}

.trend-cell {
  flex: 1 1 calc(50% - var(--space-4));
  min-width: 108px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-sm);
  background: var(--glass-bg-low);
  border: 1px solid var(--border-subtle);
}

.trend-label {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.trend-value {
  font-size: var(--font-size-sm);
  font-weight: 700;
  white-space: nowrap;
}

.trend-empty {
  font-size: var(--font-size-sm);
}

.trend-ai-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
}

.ai-growth-content {
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--text-secondary);
}

.ai-growth-content :deep(p) {
  margin: 0 0 var(--space-6);
}

.ai-growth-content :deep(li) {
  margin: var(--space-2) 0;
}
</style>
