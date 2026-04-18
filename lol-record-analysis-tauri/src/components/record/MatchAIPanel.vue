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
      <div v-else class="match-detail-ai-empty">选择分析类型后即可生成复盘结果。</div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { NModal, NRadioGroup, NRadioButton, NSelect, NButton } from 'naive-ui'
import type { MatchDetailAnalysisMode } from '@renderer/services/ai'

defineProps<{
  show: boolean
  mode: MatchDetailAnalysisMode
  targetParticipantId: number | null
  loading: boolean
  renderedResult: string
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
  gap: 12px;
}

.match-detail-ai-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.match-detail-ai-player-select {
  min-width: 240px;
}

.match-detail-ai-result {
  max-height: 70vh;
  overflow-y: auto;
  padding: 8px 4px;
  line-height: 1.8;
  font-size: 14px;
}

.match-detail-ai-result :deep(h2) {
  margin: 16px 0 8px;
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-ai-result :deep(ul) {
  padding-left: 20px;
}

.match-detail-ai-result :deep(li) {
  margin: 6px 0;
}

.match-detail-ai-result :deep(p) {
  margin: 8px 0;
}

.match-detail-ai-empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-secondary);
}

@media (max-width: 1100px) {
  .match-detail-ai-controls {
    flex-wrap: wrap;
  }
}
</style>
