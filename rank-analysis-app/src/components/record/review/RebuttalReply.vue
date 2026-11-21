<script setup lang="ts">
/**
 * 标注卡里的 AI 回应区：玩家写了理由且与模型有分歧时，AI 回应一次。
 *
 * 纯展示 + 事件上抛，不发请求、不存数据（都在 LabelCard）。三种状态：
 * - loading：AI 正在看理由；
 * - ready：立场标签 + 回复正文 + 两个态度按钮；
 * - failed：调用失败或超时，给「重试」。
 *
 * 立场为 unknown（模型输出没通过校验，走了保底文案）时不显示立场标签。
 *
 * 回复下面是「反馈去向」一栏，**按真实的上传状态说话**：
 * - uploaded：已上传，明确告诉玩家这条会用来改进评分；
 * - local：只存在本机——如实说，并给一个按钮让玩家选择上传；
 * - failed：上传没成功——如实说，给重试。
 * 早先的版本在认账时固定显示「这条已记下，会用来改进评分」，而没开分享的玩家那条反馈
 * 根本没离开过他的电脑。「会用来改进」这句话由界面按状态拼，不让模型写，
 * 避免它发挥成「我们会尽快修复」之类的承诺。
 * @property state - 当前状态
 * @property rebuttal - 回应内容；loading / failed 时为 null
 * @property feedback - 这条反馈的去向
 * @property sharing - 正在上传（按钮显示进行中）
 * @emits verdict - 玩家点了「说得有道理」或「还是不服」（可改选）
 * @emits retry - 玩家点了「重试」（AI 调用失败时）
 * @emits share - 玩家点了「上传反馈」或上传失败后的「重试」
 */
import { computed } from 'vue'
import type {
  MatchLabelRebuttal,
  RebuttalStance,
  RebuttalVerdict
} from '@renderer/services/matchLabel'

export type RebuttalState = 'loading' | 'ready' | 'failed'

/** 这条反馈的去向：已上传 / 只在本机 / 上传失败 */
export type RebuttalFeedback = 'uploaded' | 'local' | 'failed'

const props = withDefaults(
  defineProps<{
    state: RebuttalState
    rebuttal: MatchLabelRebuttal | null
    feedback?: RebuttalFeedback
    sharing?: boolean
  }>(),
  { feedback: 'local', sharing: false }
)

const emit = defineEmits<{
  (e: 'verdict', verdict: RebuttalVerdict): void
  (e: 'retry'): void
  (e: 'share'): void
}>()

/** 立场 → 标签文案；unknown 不显示标签 */
const STANCE_TEXT: Record<RebuttalStance, string | null> = {
  concede: '你说得对',
  partial: '有一部分道理',
  hold: '我还是这么看',
  unknown: null
}

const stanceText = computed(() => (props.rebuttal ? STANCE_TEXT[props.rebuttal.stance] : null))

/**
 * 已上传时告诉玩家「传上去的是什么、有什么用」。
 *
 * 按情况说具体的话，而不是一句通用的「感谢反馈」：玩家不服的那条对改进评分最有用，
 * 值得单独说出来；AI 认账的那条说明评分确实漏了东西。
 */
const uploadedText = computed(() => {
  const r = props.rebuttal
  if (!r) return ''
  if (r.verdict === 'unconvinced') return '你不服的这条已上传。这类反馈对改进评分最有用。'
  if (r.stance === 'concede' || r.stance === 'partial')
    return '评分漏算的这一点已上传，会用来改进评分。'
  return '你的看法已上传，会用来改进评分。'
})

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

      <div class="rebuttal-feedback" :class="`is-${feedback}`" data-test="rebuttal-feedback">
        <template v-if="feedback === 'uploaded'">
          <span class="rebuttal-check" aria-hidden="true">✓</span>
          <span>
            <b>已反馈成功</b>
            <span class="rebuttal-feedback-sub" data-test="rebuttal-uploaded">{{
              uploadedText
            }}</span>
          </span>
        </template>
        <template v-else>
          <span class="rebuttal-feedback-text">
            <span data-test="rebuttal-not-uploaded">{{
              feedback === 'failed'
                ? '上传没成功，这条反馈目前只在你的电脑上。'
                : '这条反馈还只存在你的电脑上。'
            }}</span>
            <span v-if="feedback === 'local'" class="rebuttal-feedback-sub">
              上传后会用来改进评分。只传你选的英雄、理由和 AI
              的立场，不含召唤师名；之后的对局判断也会自动分享，可在设置里关闭。
            </span>
          </span>
          <button
            type="button"
            class="rebuttal-share"
            :disabled="sharing"
            data-test="rebuttal-share"
            @click="emit('share')"
          >
            {{
              sharing ? '上传中…' : feedback === 'failed' ? '重试上传' : '上传反馈，帮忙改进评分'
            }}
          </button>
        </template>
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
/* 反馈去向：一条分隔线下面单独一栏，和回复正文分开 */
.rebuttal-feedback {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-top: var(--space-2);
  padding-top: var(--space-8);
  border-top: 1px dashed var(--border-subtle);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
.rebuttal-feedback b {
  margin-right: var(--space-6);
  font-weight: var(--font-weight-semibold);
  color: var(--semantic-win);
}
.rebuttal-feedback-text {
  flex: 1;
  min-width: 0;
}
.rebuttal-feedback-sub {
  color: var(--text-tertiary);
}
.rebuttal-feedback-text .rebuttal-feedback-sub {
  display: block;
  margin-top: 2px;
  line-height: 1.6;
}
/* 上传成功的对勾：出现时弹一下，让「成功了」这件事被看见 */
.rebuttal-check {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--bg-base);
  background: var(--semantic-win);
  animation: rebuttal-pop 320ms cubic-bezier(0.2, 1.4, 0.4, 1) both;
}
@keyframes rebuttal-pop {
  from {
    transform: scale(0.3);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
.rebuttal-share {
  appearance: none;
  flex: none;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
  font: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--accent-blue);
  cursor: pointer;
  transition: background var(--dur-fast);
}
.rebuttal-share:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-blue) 26%, transparent);
}
.rebuttal-share:disabled {
  cursor: default;
  opacity: 0.7;
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
.rebuttal-share:focus-visible,
.rebuttal-link:focus-visible {
  outline: 1px solid var(--accent-hover);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .rebuttal-dot {
    animation: none;
    opacity: 0.8;
  }
  .rebuttal-check {
    animation: none;
  }
}
</style>
