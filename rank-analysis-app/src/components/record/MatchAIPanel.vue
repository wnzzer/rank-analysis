<template>
  <n-modal
    :show="show"
    preset="card"
    title="AI 复盘"
    style="width: 780px"
    @update:show="emit('update:show', $event)"
  >
    <div class="match-detail-ai-modal-body">
      <div class="match-detail-ai-controls">
        <n-radio-group :value="mode" size="small" @update:value="emit('update:mode', $event)">
          <n-radio-button value="overview">整局总览</n-radio-button>
          <n-radio-button value="player">单人复盘</n-radio-button>
        </n-radio-group>

        <n-select
          v-if="mode === 'player'"
          :value="targetParticipantId"
          class="match-detail-ai-player-select"
          :options="playerOptions"
          @update:value="emit('update:targetParticipantId', $event)"
        />

        <n-button tertiary type="primary" :loading="loading" @click="emit('rerun')">
          重新分析
        </n-button>
      </div>

      <div v-if="report" class="match-detail-ai-report">
        <div class="match-detail-ai-hero">
          <span
            class="match-detail-ai-verdict-badge"
            :class="'match-detail-ai-verdict-badge--' + report.verdict"
            >{{ verdictText(report.verdict) }}</span
          >
          <span class="match-detail-ai-oneliner">{{ report.oneLiner }}</span>
        </div>

        <template v-if="report.mvps.length">
          <div class="match-detail-ai-section match-detail-ai-section--mvps">
            <h4 class="match-detail-ai-section-title">谁尽力了</h4>
            <ul class="match-detail-ai-roster">
              <li v-for="p in report.mvps" :key="p.participantId">
                <strong>{{ nameOf(p.participantId) }}</strong
                >：{{ p.reason }}
              </li>
            </ul>
          </div>
        </template>

        <template v-if="report.sunkCosts.length">
          <div class="match-detail-ai-section match-detail-ai-section--blame">
            <h4 class="match-detail-ai-section-title">谁要背锅</h4>
            <ul class="match-detail-ai-roster">
              <li v-for="p in report.sunkCosts" :key="p.participantId">
                <strong>{{ nameOf(p.participantId) }}</strong
                >：{{ p.reason }}
              </li>
            </ul>
          </div>
        </template>

        <template v-if="report.crushed.length">
          <div class="match-detail-ai-section match-detail-ai-section--crushed">
            <h4 class="match-detail-ai-section-title">谁被打爆 / 被连累</h4>
            <ul class="match-detail-ai-roster">
              <li v-for="p in report.crushed" :key="p.participantId">
                <strong>{{ nameOf(p.participantId) }}</strong
                >：{{ p.reason }}
              </li>
            </ul>
          </div>
        </template>

        <div v-if="report.ownScore" class="match-detail-ai-section">
          <h4 class="match-detail-ai-section-title">本局评分</h4>
          <div class="match-detail-ai-rating">
            <span class="match-detail-ai-rating-score">{{ report.ownScore.rating }}</span
            ><span class="match-detail-ai-rating-max">/10</span>
          </div>
          <ul class="match-detail-ai-roster">
            <li v-for="(m, i) in report.ownScore.metrics" :key="i">{{ m }}</li>
          </ul>
        </div>

        <div v-if="report.improvements?.length" class="match-detail-ai-section">
          <h4 class="match-detail-ai-section-title">改进建议</h4>
          <ul class="match-detail-ai-improvements">
            <li
              v-for="(imp, i) in report.improvements"
              :key="i"
              class="match-detail-ai-improvement"
            >
              <strong>{{ imp.title }}</strong>
              <span v-if="imp.evidence" class="match-detail-ai-improvement-evidence">
                {{ imp.evidence }}
              </span>
              <span v-if="imp.suggestion">{{ imp.suggestion }}</span>
            </li>
          </ul>
        </div>

        <div v-if="report.evidence.length" class="match-detail-ai-section">
          <h4 class="match-detail-ai-section-title">关键证据</h4>
          <ul class="match-detail-ai-evidence">
            <li v-for="(e, i) in report.evidence" :key="i">{{ e }}</li>
          </ul>
        </div>
      </div>

      <div
        v-else-if="renderedResult"
        class="match-detail-ai-result ai-report"
        v-html="renderedResult"
      ></div>
      <div v-else-if="aiLoading || loading" class="match-detail-ai-skeleton">
        <div v-if="aiStateLabel" class="match-detail-ai-skeleton-label">{{ aiStateLabel }}</div>
        <n-skeleton text :repeat="4" />
        <n-skeleton text class="match-detail-ai-skeleton-short" />
      </div>
      <div v-else class="match-detail-ai-empty">选择分析类型后即可生成复盘结果。</div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { NModal, NRadioGroup, NRadioButton, NSelect, NButton, NSkeleton } from 'naive-ui'
import type { MatchDetailAnalysisMode, AIAnalysisReport } from '@renderer/services/ai'

/**
 * AI 复盘弹窗
 * @property show - 是否显示
 * @property mode - 分析模式：整局总览 / 单人复盘
 * @property targetParticipantId - 单人复盘目标参与者 ID
 * @property loading - 重新分析按钮 loading 状态
 * @property report - D-P1 结构化报告（优先渲染卡片）；null 时走 renderedResult
 * @property renderedResult - 已渲染的 markdown HTML（降级链路：解析失败/兜底模板）
 * @property aiLoading - AI 当前是否正在请求中（用于首块文本到达前显示 skeleton）
 * @property playerOptions - 单人复盘下拉选项（兼作 participantId → 名字 查询表）
 */
const props = defineProps<{
  show: boolean
  mode: MatchDetailAnalysisMode
  targetParticipantId: number | null
  loading: boolean
  report: AIAnalysisReport | null
  renderedResult: string
  aiLoading?: boolean
  aiStateLabel?: string
  playerOptions: { label: string; value: number }[]
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'update:mode': [value: MatchDetailAnalysisMode]
  'update:targetParticipantId': [value: number | null]
  rerun: []
}>()

function verdictText(verdict: AIAnalysisReport['verdict']): string {
  return verdict === 'win' ? '胜方' : verdict === 'loss' ? '败方' : '势均'
}

function nameOf(participantId: number): string {
  return props.playerOptions.find(o => o.value === participantId)?.label ?? `玩家 #${participantId}`
}
</script>

<style scoped>
.match-detail-ai-modal-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.match-detail-ai-controls {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.match-detail-ai-player-select {
  /* 单人复盘下拉宽度，保留像素值（非 token 体系内的控件最小宽度） */
  min-width: 240px;
}

.match-detail-ai-result {
  max-height: 70vh;
  overflow-y: auto;
  padding: var(--space-8) var(--space-4);
  line-height: 1.8;
  font-size: var(--font-size-md);
}

/* D-P1 结构化报告卡片 */
.match-detail-ai-report {
  max-height: 70vh;
  overflow-y: auto;
  padding: var(--space-8) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  line-height: 1.7;
  font-size: var(--font-size-md);
}

.match-detail-ai-hero {
  display: flex;
  align-items: baseline;
  gap: var(--space-8);
}

.match-detail-ai-verdict-badge {
  flex-shrink: 0;
  padding: 2px var(--space-8);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: #fff;
}

.match-detail-ai-verdict-badge--win {
  background: var(--semantic-win);
}

.match-detail-ai-verdict-badge--loss {
  background: var(--semantic-loss);
}

.match-detail-ai-verdict-badge--neutral {
  background: var(--text-tertiary);
}

.match-detail-ai-oneliner {
  font-weight: var(--font-weight-semibold);
}

.match-detail-ai-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.match-detail-ai-section-title {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--text-secondary);
  border-left: 3px solid var(--text-secondary);
  padding-left: var(--space-8);
}

.match-detail-ai-section--mvps .match-detail-ai-section-title {
  border-left-color: var(--semantic-win);
  color: var(--semantic-win);
}

.match-detail-ai-section--blame .match-detail-ai-section-title {
  border-left-color: var(--semantic-loss);
  color: var(--semantic-loss);
}

.match-detail-ai-section--crushed .match-detail-ai-section-title {
  border-left-color: var(--semantic-warn);
  color: var(--semantic-warn);
}

.match-detail-ai-roster,
.match-detail-ai-evidence {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.match-detail-ai-roster li,
.match-detail-ai-evidence li {
  padding: var(--space-6) var(--space-12);
  border-left: 2px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--glass-bg-low);
}

.match-detail-ai-section--mvps li {
  border-left-color: var(--semantic-win);
}

.match-detail-ai-section--blame li {
  border-left-color: var(--semantic-loss);
}

.match-detail-ai-section--crushed li {
  border-left-color: var(--semantic-warn);
}

.match-detail-ai-improvements {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.match-detail-ai-improvement {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-8) var(--space-12);
  background: var(--glass-bg-low);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.match-detail-ai-improvement-evidence {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.match-detail-ai-rating {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
}

.match-detail-ai-rating-score {
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  color: var(--semantic-win);
}

.match-detail-ai-rating-max {
  color: var(--text-secondary);
}

/* 报告内容（章节着色 / hero / 数字名字高亮）由共享样式 styles/ai-report.css 提供，
   容器同时挂了 class `ai-report`，此处只保留弹窗特有的布局。 */

.match-detail-ai-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-4);
}

.match-detail-ai-skeleton-label {
  font-size: var(--font-size-md);
  color: var(--text-secondary);
  padding: 0 var(--space-4) var(--space-6);
}

.match-detail-ai-skeleton-short {
  width: 60%;
}

.match-detail-ai-empty {
  padding: var(--space-24) var(--space-8);
  text-align: center;
  color: var(--text-secondary);
}

@media (max-width: 1100px) {
  .match-detail-ai-controls {
    flex-wrap: wrap;
  }
}
</style>
