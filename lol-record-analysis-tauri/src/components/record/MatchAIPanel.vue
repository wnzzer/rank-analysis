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

.match-detail-ai-result :deep(h2) {
  margin: var(--space-16) 0 var(--space-8);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.match-detail-ai-result :deep(ul) {
  padding-left: var(--space-20);
}

.match-detail-ai-result :deep(li) {
  margin: var(--space-6) 0;
}

.match-detail-ai-result :deep(p) {
  margin: var(--space-8) 0;
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
