<script setup lang="ts">
/**
 * 选人期 BP 决策带。
 *
 * 只读 + 一个动作按钮：否决的自然动作是在客户端里自己 hover 别的英雄，
 * 所以不做「取消本次」「改为…」，UI 上只留「存为规则」。
 *
 * 来源视觉分级是「兜底可视化」的关键：兜底显示得弱不是因为它选得差
 * （避雷后未必比规则差），而是传达「这不是你的意图，是系统替你兜的」，
 * 引导用户把它固化成一条自己的规则。
 */
import { computed } from 'vue'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { getChampionName } from '@renderer/services/ai/champion-names'
import type { BpDecision, BpRejected } from '@renderer/types/bpDecision'

const props = defineProps<{
  decision: BpDecision | null
  displaySecs: number
}>()

defineEmits<{ (e: 'save-rule'): void }>()

const { getChampionUrl } = useAssetUrl()

const actionLabel = computed(() => (props.decision?.action_type === 'Ban' ? 'BAN' : '选'))

/** 标题：Auto 且轮到我了才带倒计时，Advisory 降级为「建议 X」，已接管则明说 */
const headline = computed(() => {
  const d = props.decision
  if (!d) return ''
  if (d.user_overridden) return `你已接管，本阶段不再自动${actionLabel.value}`
  if (d.mode === 'Advisory') return `建议 ${actionLabel.value}`
  // 还没轮到我：快照照常产出（预选期就要提前 hover），但此刻计时器走的是别人
  // 的回合，显示「Xs 后自动执行」等于给一个不会兑现的承诺。
  if (!d.is_in_progress) return `轮到你时自动 ${actionLabel.value}`
  return `${Math.ceil(props.displaySecs)}s 后自动 ${actionLabel.value}`
})

const originLabel = computed(() => {
  const o = props.decision?.target?.origin
  if (!o) return ''
  return o.type === 'Rule' ? `命中《${o.rule_name}》` : `兜底池 ${o.pool_size} 选 1`
})

const isFallback = computed(() => props.decision?.target?.origin.type === 'Fallback')

/** 负向依据文案：OP.GG 只有苦手数据，胜率恒 <50%，因此措辞是「仅 X%」 */
const evidenceText = computed(() => {
  const e = props.decision?.target?.evidence
  if (!e) return ''
  const pct = (e.win_rate * 100).toFixed(1)
  return `对${getChampionName(e.against_champion_id)} 仅 ${pct}%，池内无更优选择`
})

function rejectedText(r: BpRejected): string {
  switch (r.type) {
    case 'Banned':
      return `${getChampionName(r.champion_id)}（已被 ban）`
    case 'Taken':
      return `${getChampionName(r.champion_id)}（${r.by_ally ? '队友已选' : '对面已选'}）`
    case 'CounteredBy':
      return `${getChampionName(r.champion_id)}（被${getChampionName(r.opponent_id)}克制）`
    case 'RuleNotMatched':
      return `《${r.rule_name}》（条件不满足）`
  }
}
</script>

<template>
  <div v-if="decision" class="bp-bar">
    <div class="bp-headline">{{ headline }}</div>

    <div v-if="decision.target" class="bp-main">
      <img class="bp-avatar" :src="getChampionUrl(decision.target.champion_id)" alt="" />
      <span class="bp-champion">{{ getChampionName(decision.target.champion_id) }}</span>
      <span class="bp-origin" :class="isFallback ? 'bp-origin-fallback' : 'bp-origin-rule'">
        ← {{ originLabel }}
      </span>
      <button type="button" class="bp-save-rule" @click="$emit('save-rule')">存为规则</button>
    </div>
    <div v-else class="bp-main bp-empty">无可执行目标</div>

    <div v-if="evidenceText" class="bp-evidence">{{ evidenceText }}</div>

    <div v-if="decision.rejected.length > 0" class="bp-rejected">
      备选：{{ decision.rejected.map(rejectedText).join(' · ') }}
    </div>
  </div>
</template>

<style scoped>
.bp-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8) var(--space-12);
  margin-top: var(--space-8);
  border-radius: var(--radius-md);
  background: var(--glass-bg-low);
}
.bp-headline {
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.bp-main {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}
.bp-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
}
.bp-champion {
  font-weight: 600;
}
.bp-origin-rule {
  color: var(--accent-blue);
}
/* 弱化传达的是「这不是你的意图，是系统替你兜的」，不是「它选得差」 */
.bp-origin-fallback {
  color: var(--n-text-color-3);
}
.bp-empty {
  color: var(--n-text-color-3);
}
.bp-evidence,
.bp-rejected {
  font-size: var(--font-size-sm);
  color: var(--n-text-color-3);
}
.bp-save-rule {
  margin-left: auto;
  padding: var(--space-2) var(--space-8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: var(--font-size-sm);
}
</style>
