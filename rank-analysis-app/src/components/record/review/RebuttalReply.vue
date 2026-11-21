<script setup lang="ts">
/**
 * 标注卡里的 AI 回应区：玩家写了理由且与模型有分歧时，AI 回应一次。
 *
 * 纯展示 + 事件上抛，不发请求、不存数据（都在 LabelCard）。三种状态：
 * - loading：AI 正在看理由；
 * - ready：立场标签 + 回复正文 + 两个态度按钮；
 * - failed：调用失败或超时，给「重试」。
 *
 * 认账（concede / partial）时在正文后追加一句「已记下」——这句由界面拼，不让模型写，
 * 避免它发挥成「我们会尽快修复」之类的承诺。立场为 unknown（模型输出没通过校验，
 * 走了保底文案）时不显示立场标签。
 * @property state - 当前状态
 * @property rebuttal - 回应内容；loading / failed 时为 null
 * @emits verdict - 玩家点了「说得有道理」或「还是不服」（可改选）
 * @emits retry - 玩家点了「重试」
 */
import { computed } from 'vue'
import { REBUTTAL_CONCEDE_SUFFIX } from '@renderer/services/ai/review/rebuttal'
import type {
  MatchLabelRebuttal,
  RebuttalStance,
  RebuttalVerdict
} from '@renderer/services/matchLabel'

export type RebuttalState = 'loading' | 'ready' | 'failed'

const props = defineProps<{
  state: RebuttalState
  rebuttal: MatchLabelRebuttal | null
}>()

const emit = defineEmits<{
  (e: 'verdict', verdict: RebuttalVerdict): void
  (e: 'retry'): void
}>()

/** 立场 → 标签文案；unknown 不显示标签 */
const STANCE_TEXT: Record<RebuttalStance, string | null> = {
  concede: '你说得对',
  partial: '有一部分道理',
  hold: '我还是这么看',
  unknown: null
}

const stanceText = computed(() => (props.rebuttal ? STANCE_TEXT[props.rebuttal.stance] : null))

/** 认账时追加「已记下」 */
const conceded = computed(
  () => props.rebuttal?.stance === 'concede' || props.rebuttal?.stance === 'partial'
)

const VERDICTS: Array<{ value: RebuttalVerdict; text: string }> = [
  { value: 'convinced', text: '说得有道理' },
  { value: 'unconvinced', text: '还是不服' }
]
</script>

<template>
  <section class="rebuttal" :class="`is-${state}`" data-test="rebuttal">
    <div v-if="state === 'loading'" class="rebuttal-pending" data-test="rebuttal-loading">
      <span class="rebuttal-dot" aria-hidden="true" />AI 正在看你的理由…
    </div>

    <div v-else-if="state === 'failed'" class="rebuttal-pending" data-test="rebuttal-failed">
      AI 暂时没回应
      <button type="button" class="rebuttal-link" data-test="rebuttal-retry" @click="emit('retry')">
        重试
      </button>
    </div>

    <template v-else-if="rebuttal">
      <div class="rebuttal-head">
        <span class="rebuttal-who">AI 回应</span>
        <span
          v-if="stanceText"
          class="rebuttal-stance"
          :class="`stance-${rebuttal.stance}`"
          data-test="rebuttal-stance"
          >{{ stanceText }}</span
        >
      </div>
      <p class="rebuttal-text" data-test="rebuttal-text">{{ rebuttal.reply }}</p>
      <p v-if="conceded" class="rebuttal-noted" data-test="rebuttal-noted">
        {{ REBUTTAL_CONCEDE_SUFFIX }}
      </p>
      <div class="rebuttal-actions">
        <button
          v-for="v in VERDICTS"
          :key="v.value"
          type="button"
          class="rebuttal-btn"
          :class="{ 'is-picked': rebuttal.verdict === v.value }"
          :aria-pressed="rebuttal.verdict === v.value"
          :data-test="`rebuttal-${v.value}`"
          @click="emit('verdict', v.value)"
        >
          {{ v.text }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rebuttal {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  border: 1px solid var(--sunken-border);
}
.rebuttal-pending {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
/* 等待中的小圆点：呼吸一下，告诉玩家还在处理 */
.rebuttal-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-blue);
  animation: rebuttal-breathe 1.2s ease-in-out infinite;
}
@keyframes rebuttal-breathe {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}
.rebuttal-link {
  appearance: none;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--accent-blue);
  cursor: pointer;
}
.rebuttal-link:hover {
  text-decoration: underline;
}
.rebuttal-head {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}
.rebuttal-who {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 1px;
  color: var(--text-tertiary);
}
/* 立场标签：认账绿、部分认同黄、坚持中性——颜色只表达「AI 让步了多少」 */
.rebuttal-stance {
  --stance-color: var(--text-secondary);
  padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--stance-color);
  background: color-mix(in srgb, var(--stance-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--stance-color) 35%, transparent);
}
.rebuttal-stance.stance-concede {
  --stance-color: var(--semantic-win);
}
.rebuttal-stance.stance-partial {
  --stance-color: var(--semantic-warn);
}
.rebuttal-text {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  color: var(--text-primary);
}
.rebuttal-noted {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.rebuttal-actions {
  display: flex;
  gap: var(--space-8);
}
.rebuttal-btn {
  appearance: none;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    color var(--dur-fast),
    border-color var(--dur-fast),
    background var(--dur-fast);
}
.rebuttal-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-tertiary);
}
.rebuttal-btn.is-picked {
  color: var(--text-primary);
  border-color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
}
.rebuttal-btn:focus-visible,
.rebuttal-link:focus-visible {
  outline: 1px solid var(--accent-hover);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .rebuttal-dot {
    animation: none;
    opacity: 0.8;
  }
}
</style>
