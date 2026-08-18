<template>
  <div class="match-detail-backtest">
    <section v-if="stats" class="match-detail-backtest-stats">
      <div class="match-detail-backtest-stats-title">采纳 vs 未采纳（防幸存者偏差的对账视图）</div>
      <div v-if="stats.pendingTotal > 0" class="match-detail-backtest-pending">
        待对账建议 {{ stats.pendingTotal }} 条——打开赛后详情页会自动对账
      </div>
      <div class="match-detail-backtest-stats-rows">
        <div class="match-detail-backtest-stats-row">
          <span>采纳建议</span>
          <span class="font-number">{{ stats.adoptedTotal }} 局</span>
          <span v-if="stats.adoptedWinRate !== null" class="font-number">
            胜率 {{ (stats.adoptedWinRate * 100).toFixed(0) }}%
          </span>
          <span v-else class="match-detail-backtest-stats-na">暂无样本</span>
        </div>
        <div class="match-detail-backtest-stats-row">
          <span>未采纳</span>
          <span class="font-number">{{ stats.notAdoptedTotal }} 局</span>
          <span v-if="stats.notAdoptedWinRate !== null" class="font-number">
            胜率 {{ (stats.notAdoptedWinRate * 100).toFixed(0) }}%
          </span>
          <span v-else class="match-detail-backtest-stats-na">暂无样本</span>
        </div>
      </div>
    </section>

    <div v-if="loading" class="match-detail-backtest-note">本局决策对账中…</div>
    <div v-else-if="result === null" class="match-detail-backtest-note">
      决策对账不可用（后端未响应）
    </div>
    <div v-else-if="!result.aligned" class="match-detail-backtest-note">
      {{ reasonLabel(result.reason) }}
    </div>
    <template v-else>
      <div class="match-detail-backtest-vs">
        <div class="match-detail-backtest-hero">
          <img
            class="match-detail-backtest-avatar"
            :src="getChampionUrl(result.suggestionChampionId ?? 0)"
            alt=""
          />
          <span class="match-detail-backtest-hero-role">建议</span>
          <span class="match-detail-backtest-hero-id font-number"
            >#{{ result.suggestionChampionId }}</span
          >
        </div>
        <span class="match-detail-backtest-vs-mark">vs</span>
        <div class="match-detail-backtest-hero">
          <img
            class="match-detail-backtest-avatar"
            :src="getChampionUrl(result.actualChampionId ?? 0)"
            alt=""
          />
          <span class="match-detail-backtest-hero-role">实选</span>
          <span class="match-detail-backtest-hero-id font-number"
            >#{{ result.actualChampionId }}</span
          >
        </div>
        <div class="match-detail-backtest-result">
          <span
            class="match-detail-backtest-badge"
            :class="result.adopted ? 'is-adopted' : 'is-skipped'"
            >{{ result.adopted ? '已采纳' : '未采纳' }}</span
          >
          <span
            class="match-detail-backtest-win"
            :class="result.resultWin ? 'is-win' : 'is-lose'"
            >{{ result.resultWin ? '胜' : '负' }}</span
          >
        </div>
      </div>

      <div v-if="result.backtest" class="match-detail-backtest-metrics">
        <div v-if="result.backtest.insufficientData" class="match-detail-backtest-insufficient">
          样本不足（本地对位 ≥5 局且双方各 ≥3 局），本局不做胜负判断
        </div>
        <template v-else>
          <div class="match-detail-backtest-metric">
            <span class="match-detail-backtest-metric-label">历史胜率差</span>
            <span
              class="match-detail-backtest-metric-value font-number"
              :class="deltaClass(result.backtest.winRateGap)"
              >{{ formatPercent(result.backtest.winRateGap) }}</span
            >
          </div>
          <div class="match-detail-backtest-metric">
            <span class="match-detail-backtest-metric-label">表现分差（17 分制）</span>
            <span
              class="match-detail-backtest-metric-value font-number"
              :class="deltaClass(result.backtest.scoreGap)"
              >{{ result.backtest.scoreGap > 0 ? '+' : ''
              }}{{ result.backtest.scoreGap.toFixed(1) }}</span
            >
          </div>
          <div class="match-detail-backtest-metric">
            <span class="match-detail-backtest-metric-label">置信度</span>
            <span class="match-detail-backtest-metric-value font-number"
              >{{ (result.backtest.confidence * 100).toFixed(0) }}%（封顶 40%）</span
            >
          </div>
        </template>
        <ul class="match-detail-backtest-caveats">
          <li
            v-for="(c, i) in result.backtest.caveats"
            :key="i"
            class="match-detail-backtest-caveat"
          >
            {{ c }}
          </li>
        </ul>
      </div>
    </template>

    <p class="match-detail-backtest-note">
      决策回测为描述性对位对比（非因果推断）：把"赛前建议 vs 实际选择"与本地历史表现做对位，
      用于校准建议质量，不构成胜负预测。
    </p>
  </div>
</template>

<script lang="ts" setup>
import { inject, onMounted, ref } from 'vue'
import { matchDetailContextKey } from '../matchDetailContext'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import {
  fetchAdoptionStats,
  fetchDecisionBacktest,
  reasonLabel,
  type AdoptionStats,
  type DecisionBacktest
} from '@renderer/features/record/services/backtest'

const injected = inject(matchDetailContextKey)
if (!injected) throw new Error('MatchDetailBacktestTab 必须在 MatchDetailInline 容器内使用')
const ctx = injected as NonNullable<typeof injected>

const { getChampionUrl } = useAssetUrl()

const loading = ref(true)
const result = ref<DecisionBacktest | null>(null)
const stats = ref<AdoptionStats | null>(null)

onMounted(async () => {
  const gameId = ctx.game.value?.gameId
  if (gameId == null) {
    loading.value = false
    return
  }
  loading.value = true
  const [r, s] = await Promise.all([fetchDecisionBacktest(gameId), fetchAdoptionStats()])
  result.value = r
  stats.value = s
  loading.value = false
})

function formatPercent(gap: number): string {
  return `${gap > 0 ? '+' : ''}${(gap * 100).toFixed(1)}%`
}

function deltaClass(v: number): string {
  return v > 0.005 ? 'is-pos' : v < -0.005 ? 'is-neg' : ''
}
</script>

<style scoped>
.match-detail-backtest {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
}
.match-detail-backtest-stats {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.match-detail-backtest-stats-title {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
  margin-bottom: 6px;
}
.match-detail-backtest-pending {
  font-size: 11px;
  color: #d9b36a;
  margin-bottom: 6px;
}
.match-detail-backtest-stats-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.match-detail-backtest-stats-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.match-detail-backtest-stats-row > span:first-child {
  flex: 0 0 64px;
  color: var(--n-text-color-2, #ccc);
}
.match-detail-backtest-stats-row > span:nth-child(2) {
  flex: 0 0 64px;
}
.match-detail-backtest-stats-na {
  color: var(--n-text-color-3, #999);
}
.match-detail-backtest-vs {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.match-detail-backtest-hero {
  display: flex;
  align-items: center;
  gap: 6px;
}
.match-detail-backtest-avatar {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  object-fit: cover;
}
.match-detail-backtest-hero-role {
  font-size: 10px;
  color: var(--n-text-color-3, #999);
}
.match-detail-backtest-hero-id {
  font-size: 12px;
}
.match-detail-backtest-vs-mark {
  color: var(--n-text-color-3, #999);
  font-size: 10px;
}
.match-detail-backtest-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.match-detail-backtest-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
}
.match-detail-backtest-badge.is-adopted {
  background: rgba(99, 226, 183, 0.16);
  color: #57d9a3;
}
.match-detail-backtest-badge.is-skipped {
  background: rgba(224, 122, 122, 0.14);
  color: #e07a7a;
}
.match-detail-backtest-win {
  font-size: 12px;
  font-weight: 600;
}
.match-detail-backtest-win.is-win {
  color: #57d9a3;
}
.match-detail-backtest-win.is-lose {
  color: #e07a7a;
}
.match-detail-backtest-metrics {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.match-detail-backtest-insufficient {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}
.match-detail-backtest-metric {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.match-detail-backtest-metric-label {
  color: var(--n-text-color-2, #ccc);
}
.match-detail-backtest-metric-value.is-pos {
  color: #57d9a3;
}
.match-detail-backtest-metric-value.is-neg {
  color: #e07a7a;
}
.match-detail-backtest-caveats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.match-detail-backtest-caveat {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}
.match-detail-backtest-note {
  font-size: 11px;
  color: var(--n-text-color-3, #999);
}
</style>
