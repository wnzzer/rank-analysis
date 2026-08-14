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

      <!-- D-P3 分时曲线：懒加载，展示近 10 场平均的分钟维度画像 -->
      <n-flex align="center" justify="space-between">
        <span class="trend-ai-label">分时曲线</span>
        <n-button
          size="tiny"
          secondary
          :loading="curveLoading"
          :disabled="!curveAvailable"
          @click="onToggleCurve"
        >
          {{ curveVisible ? '收起' : '查看' }}
        </n-button>
      </n-flex>
      <div v-if="curveVisible" class="curve-panel">
        <n-spin v-if="curveLoading" size="small" />
        <n-text v-else-if="curveError" depth="3" class="trend-empty">
          SGP 帧数据未就绪（近 10 场无法解析，可能为 LCU 数据源）
        </n-text>
        <template v-else-if="curve">
          <div class="curve-row">
            <span class="curve-label curve-label-cs">补刀（累计）</span>
            <svg
              class="curve-svg"
              :viewBox="`0 0 ${CURVE_W} ${CURVE_H}`"
              preserveAspectRatio="none"
            >
              <polyline
                :points="polyPoints(curve.cs)"
                fill="none"
                class="curve-line curve-line-cs"
              />
            </svg>
          </div>
          <div class="curve-row">
            <span class="curve-label curve-label-death">死亡（累计）</span>
            <svg
              class="curve-svg"
              :viewBox="`0 0 ${CURVE_W} ${CURVE_H}`"
              preserveAspectRatio="none"
            >
              <polyline
                :points="polyPoints(curve.deaths)"
                fill="none"
                class="curve-line curve-line-death"
              />
            </svg>
          </div>
          <div class="curve-row">
            <span class="curve-label curve-label-fight">参团击杀/分钟</span>
            <svg
              class="curve-svg"
              :viewBox="`0 0 ${CURVE_W} ${CURVE_H}`"
              preserveAspectRatio="none"
            >
              <polyline
                :points="polyPoints(curve.fights)"
                fill="none"
                class="curve-line curve-line-fight"
              />
            </svg>
          </div>
          <n-text depth="3" class="curve-source">
            近 {{ curve.sourceCount }} 场平均 · 分钟轴 0–{{ curve.minutes.length - 1 }} 分钟
          </n-text>
        </template>
      </div>
    </n-flex>
  </n-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NCard, NButton, NFlex, NText, NSpin } from 'naive-ui'
import type { RecentData } from '@renderer/types/domain/analysis'
import type { Game } from '@renderer/types/domain/match'
import { kdaColor, winRateColor, groupRateColor } from '@renderer/utils/colors'
import { winRate } from '@renderer/utils/rank'
import { useGrowthReport } from '@renderer/composables/useGrowthReport'
import { useMinuteCurve } from '@renderer/composables/useMinuteCurve'
import { MINUTE_CURVE_LIMIT } from '@renderer/composables/useMinuteCurve'

const props = withDefaults(
  defineProps<{
    recentData: RecentData
    mode: string
    isDark: boolean
    /** 近期对局（时间降序，供分时曲线取最近 limit 场） */
    games?: Game[]
    /** 本人 puuid（跨区时 games[0] 兜底） */
    myPuuid?: string
  }>(),
  { games: () => [], myPuuid: '' }
)

const { loading, result, renderedResult, generate } = useGrowthReport()

const hasSamples = computed(() => (props.recentData.samples ?? 0) > 0)
const winRateNum = computed(() =>
  winRate(props.recentData.selectWins, props.recentData.selectLosses)
)

const onGenerate = () => generate(props.recentData)

// ── 分时曲线（D-P3）──
const curveGames = computed(() =>
  props.games
    .slice(0, MINUTE_CURVE_LIMIT)
    .map(g => ({ gameId: g.gameId, platformId: g.platformId }))
)
const selfPuuid = computed(
  () => props.myPuuid || props.games[0]?.participantIdentities?.[0]?.player?.puuid || ''
)

const {
  curve,
  loading: curveLoading,
  error: curveError,
  load: curveLoad,
  reset: curveReset
} = useMinuteCurve(curveGames, selfPuuid)

const curveVisible = ref(false)
/** 无游戏列表（如跨区未收集）时按钮禁用 */
const curveAvailable = computed(() => curveGames.value.length > 0 && !!selfPuuid.value)

async function onToggleCurve() {
  if (curveVisible.value) {
    curveVisible.value = false
    curveReset()
    return
  }
  curveVisible.value = true
  if (!curve.value) await curveLoad()
}

// SVG 迷你折线：归一化到 viewBox，横轴=分钟数，纵轴=值域
const CURVE_W = 240
const CURVE_H = 40
const PAD = 4

function polyPoints(values: number[]): string {
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? (CURVE_W - PAD * 2) / (values.length - 1) : CURVE_W - PAD * 2
  return values
    .map(
      (v, i) =>
        `${(PAD + i * step).toFixed(1)},${(CURVE_H - PAD - (v / max) * (CURVE_H - PAD * 2)).toFixed(1)}`
    )
    .join(' ')
}
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

/* === 分时曲线（D-P3） === */
.curve-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8);
  border-radius: var(--radius-sm);
  background: var(--glass-bg-low);
  border: 1px solid var(--border-subtle);
}

.curve-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.curve-label {
  width: 72px;
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  white-space: nowrap;
}

.curve-label-cs {
  color: var(--semantic-win, #18a058);
}

.curve-label-death {
  color: var(--semantic-loss, #d03050);
}

.curve-label-fight {
  color: var(--semantic-warn, #d08770);
}

.curve-svg {
  flex: 1;
  width: 100%;
  height: 40px;
}

.curve-line {
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.curve-line-cs {
  stroke: var(--semantic-win, #18a058);
}

.curve-line-death {
  stroke: var(--semantic-loss, #d03050);
}

.curve-line-fight {
  stroke: var(--semantic-warn, #d08770);
}

.curve-source {
  font-size: var(--font-size-2xs);
  opacity: 0.7;
}

.ai-growth-content :deep(p) {
  margin: 0 0 var(--space-6);
}

.ai-growth-content :deep(li) {
  margin: var(--space-2) 0;
}
</style>
