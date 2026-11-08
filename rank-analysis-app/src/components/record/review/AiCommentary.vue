<template>
  <section class="ai-commentary">
    <div class="ai-commentary-head">
      <div class="review-section-title" data-test="ai-title">{{ title }}</div>
      <div class="ai-commentary-actions">
        <n-button
          v-if="playerActionLabel"
          size="tiny"
          secondary
          type="info"
          :disabled="loading"
          data-test="ai-player"
          @click="emit('player')"
        >
          {{ playerActionLabel }}
        </n-button>
        <n-button
          v-if="showOverviewAction"
          size="tiny"
          tertiary
          :disabled="loading"
          data-test="ai-overview"
          @click="emit('overview')"
        >
          回到整局点评
        </n-button>
        <n-button
          size="tiny"
          tertiary
          :disabled="loading"
          data-test="ai-rerun"
          @click="emit('rerun')"
        >
          重新生成
        </n-button>
      </div>
    </div>

    <div
      v-if="html"
      class="ai-commentary-body ai-report"
      data-test="ai-body"
      @click="onBodyClick"
      v-html="html"
    ></div>
    <div v-else-if="loading" class="ai-commentary-skeleton" data-test="ai-skeleton">
      <div v-if="stateLabel" class="ai-commentary-state">{{ stateLabel }}</div>
      <n-skeleton text :repeat="3" />
    </div>
    <div v-else-if="stateLabel" class="ai-commentary-error" data-test="ai-error">
      {{ stateLabel }}
    </div>
    <div v-else class="ai-commentary-empty" data-test="ai-empty">
      打开复盘后会自动生成整局点评。
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ⑦ AI 点评：流式渲染 renderAnalysisReport 的 HTML；引用角标 [D4]/[F2] 可点击定位
 * （悬停仍显示卡片原文，来自角标 title）。切换玩家不自动重跑，由按钮按需生成单人点评。
 * @property html - 已渲染的报告 HTML（renderAnalysisReport 输出，已防注入）
 * @property loading - 是否在请求中（首块到达前显示骨架）
 * @property stateLabel - 状态文案（「正在生成锐评...」）；非加载且无正文时即失败文案（「AI 分析失败：…」），替代空态提示
 * @property title - 区块标题（整局点评 / XX 单人点评）
 * @property playerActionLabel - 「生成XX的点评」按钮文案；null 不显示
 * @property showOverviewAction - 是否显示「回到整局点评」
 * @emits cite - 点击引用角标（卡片编号，如 D4）
 * @emits player / overview / rerun - 三个按钮
 */
import { NButton, NSkeleton } from 'naive-ui'

defineProps<{
  html: string
  loading: boolean
  stateLabel: string
  title: string
  playerActionLabel: string | null
  showOverviewAction: boolean
}>()

const emit = defineEmits<{
  cite: [cardId: string]
  player: []
  overview: []
  rerun: []
}>()

/** 事件委托：点到 .ai-cite 角标时发出其编号 */
function onBodyClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  const cite = target?.closest?.('.ai-cite')
  const id = cite?.textContent?.trim()
  if (id) emit('cite', id)
}
</script>

<style scoped>
.ai-commentary {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.ai-commentary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
}

.ai-commentary-actions {
  display: flex;
  gap: var(--space-6);
}

.ai-commentary-body {
  line-height: 1.8;
  font-size: var(--font-size-md);
}

.ai-commentary-body :deep(.ai-cite) {
  cursor: pointer;
}

.ai-commentary-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.ai-commentary-state {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.ai-commentary-error {
  color: var(--semantic-loss);
  font-size: var(--font-size-sm);
}

.ai-commentary-empty {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}
</style>
