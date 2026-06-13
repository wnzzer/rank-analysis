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

      <div v-if="renderedResult" class="match-detail-ai-result" v-html="renderedResult"></div>
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
import type { MatchDetailAnalysisMode } from '@renderer/services/ai'

/**
 * AI 复盘弹窗
 * @property show - 是否显示
 * @property mode - 分析模式：整局总览 / 单人复盘
 * @property targetParticipantId - 单人复盘目标参与者 ID
 * @property loading - 重新分析按钮 loading 状态
 * @property renderedResult - 已渲染的 markdown HTML（流式拼接）
 * @property aiLoading - AI 当前是否正在请求中（用于首块文本到达前显示 skeleton）
 * @property playerOptions - 单人复盘下拉选项
 */
defineProps<{
  show: boolean
  mode: MatchDetailAnalysisMode
  targetParticipantId: number | null
  loading: boolean
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

/* 章节标题：左色条 + ::before 图标，按 renderReport 注入的 section class 着色 */
.match-detail-ai-result :deep(h2.ai-section) {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin: var(--space-20) 0 var(--space-8);
  padding-left: var(--space-12);
  border-left: 3px solid var(--text-tertiary);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.match-detail-ai-result :deep(h2.ai-section)::before {
  font-size: var(--font-size-md);
}

.match-detail-ai-result :deep(h2.ai-section--verdict) {
  border-left-color: var(--text-secondary);
}
.match-detail-ai-result :deep(h2.ai-section--verdict)::before {
  content: '🎯';
}
.match-detail-ai-result :deep(h2.ai-section--effort) {
  border-left-color: var(--semantic-win);
  color: var(--semantic-win);
}
.match-detail-ai-result :deep(h2.ai-section--effort)::before {
  content: '💪';
}
.match-detail-ai-result :deep(h2.ai-section--blame) {
  border-left-color: var(--semantic-loss);
  color: var(--semantic-loss);
}
.match-detail-ai-result :deep(h2.ai-section--blame)::before {
  content: '⚠';
}
.match-detail-ai-result :deep(h2.ai-section--crushed) {
  border-left-color: var(--semantic-warn);
  color: var(--semantic-warn);
}
.match-detail-ai-result :deep(h2.ai-section--crushed)::before {
  content: '🩹';
}
.match-detail-ai-result :deep(h2.ai-section--evidence) {
  border-left-color: var(--text-tertiary);
  color: var(--text-secondary);
}
.match-detail-ai-result :deep(h2.ai-section--evidence)::before {
  content: '🔍';
}

/* 一句话定论：紧随标题的段落做成醒目 hero 卡片 */
.match-detail-ai-result :deep(h2.ai-section--verdict + p) {
  margin: var(--space-8) 0 0;
  padding: var(--space-12) var(--space-16);
  background: var(--glass-bg-mid);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-normal);
  color: var(--text-primary);
}

/* bullet 改成带左色条的卡片行 */
.match-detail-ai-result :deep(ul) {
  padding-left: 0;
  list-style: none;
}

.match-detail-ai-result :deep(li) {
  margin: var(--space-6) 0;
  padding: var(--space-6) var(--space-12);
  border-left: 2px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--glass-bg-low);
}

.match-detail-ai-result :deep(h2.ai-section--effort + ul li) {
  border-left-color: var(--semantic-win);
}
.match-detail-ai-result :deep(h2.ai-section--blame + ul li) {
  border-left-color: var(--semantic-loss);
}
.match-detail-ai-result :deep(h2.ai-section--crushed + ul li) {
  border-left-color: var(--semantic-warn);
}
.match-detail-ai-result :deep(h2.ai-section--evidence + ul li) {
  border-left-color: var(--text-tertiary);
}

.match-detail-ai-result :deep(p) {
  margin: var(--space-8) 0;
}

/* 行内高亮：数字 pill + 名字加粗（由 renderReport 注入） */
.match-detail-ai-result :deep(.ai-num) {
  padding: 0 var(--space-4);
  border-radius: var(--radius-xs);
  background: var(--glass-bg-high);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.match-detail-ai-result :deep(.ai-name) {
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

/* 兜底报告的提示 blockquote 做成 warning 条 */
.match-detail-ai-result :deep(blockquote) {
  margin: var(--space-8) 0;
  padding: var(--space-8) var(--space-12);
  border-left: 3px solid var(--semantic-warn);
  background: var(--glass-bg-low);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}
.match-detail-ai-result :deep(blockquote p) {
  margin: 0;
}

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
