<template>
  <span class="review-label" :class="`review-label--${tone}`">{{ label }}</span>
</template>

<script setup lang="ts">
/**
 * 评分标签徽章。配色与 AI 锐评章节一致（styles/ai-report.css）：
 * 尽力 = 胜利绿（谁尽力了），被连累/被爆 = 琥珀（谁被打爆/被连累），犯罪/缚地灵 = 失败红（谁要背锅），
 * 正常 = 中性灰。
 * @property label - 评分标签
 */
import { computed } from 'vue'
import type { VerdictLabel } from '@renderer/services/ai/matchDetail/types'

const props = defineProps<{ label: VerdictLabel }>()

/** 标签 → 色调 */
const TONE: Record<VerdictLabel, 'good' | 'warn' | 'bad' | 'neutral'> = {
  尽力: 'good',
  被连累: 'warn',
  被爆: 'warn',
  犯罪: 'bad',
  缚地灵: 'bad',
  正常: 'neutral'
}

const tone = computed(() => TONE[props.label])
</script>

<style scoped>
.review-label {
  display: inline-block;
  padding: 0 var(--space-6);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-2xs);
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
}

.review-label--good {
  color: var(--semantic-win);
  background: color-mix(in srgb, var(--semantic-win) 16%, transparent);
}

.review-label--warn {
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 16%, transparent);
}

.review-label--bad {
  color: var(--semantic-loss);
  background: color-mix(in srgb, var(--semantic-loss) 16%, transparent);
}

.review-label--neutral {
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--text-tertiary) 14%, transparent);
}
</style>
