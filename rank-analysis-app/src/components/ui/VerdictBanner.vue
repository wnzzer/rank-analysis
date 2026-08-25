<template>
  <div class="vb" :class="stateClass" role="status">
    <ChargeRing
      v-if="state !== 'idle'"
      :percent="seconds === null ? 100 : ((seconds ?? 0) / total) * 100"
      :label="seconds === null ? undefined : `${seconds}s`"
    />
    <div v-else class="ring ring--idle" aria-hidden="true"></div>

    <div class="vb__main">
      <div class="vb__line">
        <span class="vb__concl">{{ state === 'fallback' ? '兜底建议' : '建议' }}</span>
        <template v-if="state !== 'idle'">
          &nbsp;&nbsp;<span class="vb__verb">{{ verb }}</span
          >&nbsp;
          <span class="vb__champ">{{ champion }}</span>
        </template>
        <span v-else class="vb__champ">等待锁定…</span>
      </div>
      <div v-if="reason" class="vb__why">{{ reason }}</div>
    </div>

    <div v-if="tierLabel && state !== 'idle'" class="vb__tier">
      推荐依据 梯度
      <span
        class="vb__tiersel"
        role="button"
        tabindex="0"
        @click="$emit('switchTier')"
        @keyup.enter="$emit('switchTier')"
      >
        {{ tierLabel }} <ChevronDown class="vb__tiersel-glyph" />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * VerdictBanner —— 结论带（设计系统 v3 §7.2，全应用最核心组件）
 *
 * 三态：
 * - decision：金色结论（正常推荐）
 * - fallback：去金弱化——传达"这是系统替你兜的"，引导存规则（沿用 BpDecisionBar 意图）
 * - idle：虚线 + 等待锁定，环不显示秒数
 *
 * 尺寸由容器决定（deck 模式放大字号），本组件只管状态语义。
 */
import { computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import ChargeRing from './ChargeRing.vue'

const props = withDefaults(
  defineProps<{
    /** 展示状态 */
    state?: 'decision' | 'fallback' | 'idle'
    /** 动作词：选 / BAN */
    verb?: string
    /** 结论英雄名 */
    champion?: string
    /** 一句话理由（超长由调用方截断） */
    reason?: string
    /** 当前梯度标签，如 "T1"；空则隐藏梯度选择器 */
    tierLabel?: string
    /** 剩余秒数；null 表示无倒计时（环满格） */
    seconds?: number | null
    /** 倒计时总长（用于换算进度） */
    total?: number
  }>(),
  {
    state: 'decision',
    verb: '选',
    champion: '',
    reason: '',
    tierLabel: '',
    seconds: null,
    total: 30
  }
)

defineEmits<{ switchTier: [] }>()

const stateClass = computed(() =>
  props.state === 'fallback' ? 'vb--fallback' : props.state === 'idle' ? 'vb--idle' : ''
)
</script>

<style scoped>
.vb {
  display: flex;
  align-items: center;
  gap: var(--space-16);
  padding: var(--space-16) var(--space-20);
  background: linear-gradient(90deg, var(--brand-soft), transparent 62%), var(--bg-surface);
  border: 1px solid var(--brand-border);
  clip-path: var(--clip-corner-md);
  position: relative;
  overflow: hidden;
}
/* 扫光：仅 decision 态的仪式感 */
.vb::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(105deg, transparent 40%, var(--brand-soft) 50%, transparent 60%);
  animation: vb-sweep 3.4s var(--ease-expo) infinite;
}
@keyframes vb-sweep {
  0%,
  55% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(110%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .vb::after {
    animation: none;
    opacity: 0;
  }
}

.vb--fallback {
  background: var(--bg-surface);
  border-color: var(--border-subtle);
}
.vb--fallback .vb__champ {
  background: none;
  -webkit-text-fill-color: currentcolor;
  color: var(--text-primary);
}
.vb--fallback .vb__concl {
  color: var(--warn);
}
.vb--fallback::after {
  animation: none;
  opacity: 0;
}

.vb--idle {
  border-style: dashed;
}
.vb--idle .vb__champ {
  background: none;
  -webkit-text-fill-color: currentcolor;
  color: var(--text-tertiary);
  font-weight: var(--font-weight-semibold);
}
.ring--idle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 2px dashed var(--border-strong);
  animation: idle-spin 6s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ring--idle {
    animation: none;
  }
}
@keyframes idle-spin {
  to {
    transform: rotate(360deg);
  }
}

.vb__main {
  min-width: 0;
}
.vb__line {
  display: flex;
  align-items: baseline;
}
.vb__concl {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
}
.vb__verb {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.vb__champ {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  letter-spacing: var(--tracking-tight);
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.vb__why {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: var(--space-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vb__tier {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  flex: none;
}
.vb__tiersel {
  font-weight: var(--font-weight-semibold);
  color: var(--info);
  border: 1px solid var(--info-border);
  padding: 4px 12px;
  cursor: pointer;
  clip-path: var(--clip-notch);
}
.vb__tiersel-glyph {
  width: 10px;
  height: 10px;
  vertical-align: -1px;
}
</style>
