<script setup lang="ts">
/**
 * 选人期 BP 操作台。
 *
 * ban 与 pick 共用同一布局，只换主题色。面板自身不做任何决策：
 * 候选的排序、自动执行目标、当前预选都由调用方算好传入，用户操作一律上抛。
 *
 * 预选（单击卡片）与确认（按钮 / 回车）分两步，是因为确认不可撤回——
 * 两步操作本身就是确认，所以不再弹确认框。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type {
  BpCandidate,
  BpChampionOption,
  BpDamageMix,
  BpPanelAction,
  BpPanelStage,
  BpReasonKind
} from '@renderer/types/bpPanel'

const props = withDefaults(
  defineProps<{
    /** 当前动作类型 */
    action: BpPanelAction
    /** 面板状态：等待 / 轮到我 / 已完成 */
    stage: BpPanelStage
    /** 已排序的候选卡片（调用方负责截断到要展示的数量） */
    candidates: BpCandidate[]
    /** 超时后会被自动执行的英雄；null = 无兜底（开关关闭或无池内候选） */
    autoTargetId: number | null
    /** 客户端里当前实际预选的英雄；0 / null = 未预选 */
    hoveredId: number | null
    /** 用户是否已手动接管（接管后本阶段不再自动执行） */
    overridden: boolean
    /** 本回合剩余秒数 */
    secsLeft: number
    /** 本回合总秒数，用于倒计时环的比例 */
    totalSecs: number
    /** 我方伤害构成 */
    allyMix: BpDamageMix
    /** 敌方伤害构成 */
    enemyMix: BpDamageMix
    /** 搜索框可选英雄 */
    championOptions?: BpChampionOption[]
    /** `done` 状态下展示的结果英雄名 */
    resultName?: string
  }>(),
  { championOptions: () => [], resultName: '' }
)

const emit = defineEmits<{
  /** 预选某英雄（可撤回） */
  (e: 'hover', championId: number): void
  /** 确认当前预选（不可撤回） */
  (e: 'confirm'): void
}>()

const verb = computed(() => (props.action === 'ban' ? '禁用' : '选择'))
const confirmVerb = computed(() => (props.action === 'ban' ? '禁用' : '锁定'))

const hovered = computed(() => {
  const id = props.hoveredId
  if (!id) return null
  return props.candidates.find(c => c.championId === id) ?? null
})

/** 当前预选的英雄名；预选了推荐列表之外的英雄时从搜索选项里取 */
const hoveredName = computed(() => {
  if (hovered.value) return hovered.value.name
  const id = props.hoveredId
  if (!id) return ''
  return props.championOptions.find(o => o.value === id)?.label ?? `英雄 ${id}`
})

const autoTarget = computed(
  () => props.candidates.find(c => c.championId === props.autoTargetId) ?? null
)

/** 自动兜底是否仍然生效：有目标且用户没接管 */
const autoActive = computed(() => !!autoTarget.value && !props.overridden)

const secsDisplay = computed(() => Math.max(0, Math.ceil(props.secsLeft)))

/** 倒计时环剩余比例 0~1 */
const ringRatio = computed(() => {
  if (props.totalSecs <= 0) return 0
  return Math.min(1, Math.max(0, props.secsLeft / props.totalSecs))
})

/** 倒计时环周长（r=15.5） */
const RING_LEN = 2 * Math.PI * 15.5

const statusText = computed(() => {
  if (props.stage === 'done') return `已${confirmVerb.value} ${props.resultName}`
  if (props.stage === 'waiting') {
    const top = autoTarget.value ?? props.candidates[0]
    return top ? `轮到你时建议${verb.value} ${top.name}` : `等待轮到你${verb.value}`
  }
  if (props.overridden) return '你已接管，本回合不会自动执行'
  if (autoTarget.value)
    return `不操作将在 ${secsDisplay.value}s 后自动${verb.value} ${autoTarget.value.name}`
  return `请${verb.value}英雄，系统不会替你操作`
})

const REASON_ICON: Record<BpReasonKind, string> = {
  meta: '◆',
  mastery: '★',
  counter: '⚔',
  risk: '⚠',
  comp: '◐',
  nemesis: '☠'
}

/** 百分点贡献的展示文案，带正负号 */
function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
  return `${sign}${Math.abs(delta).toFixed(1)}%`
}

/** 构成条某一段的宽度百分比 */
function mixWidth(mix: BpDamageMix, key: 'physical' | 'magic'): string {
  const total = mix.physical + mix.magic
  if (mix.known === 0 || total <= 0) return '50%'
  return `${((mix[key] / total) * 100).toFixed(1)}%`
}

/** 构成条右侧的文字说明 */
function mixLabel(mix: BpDamageMix): string {
  const total = mix.physical + mix.magic
  if (mix.known === 0 || total <= 0) return '未知'
  const magic = Math.round((mix.magic / total) * 100)
  return `物理 ${100 - magic}% · 魔法 ${magic}%`
}

function onHover(championId: number): void {
  if (props.stage !== 'acting') return
  emit('hover', championId)
}

function onConfirm(): void {
  if (props.stage !== 'acting' || !props.hoveredId) return
  emit('confirm')
}

/**
 * 快捷键：数字键预选对应卡片，回车确认。
 * 焦点在输入控件里时不拦截，否则搜索框里打数字会误触发预选。
 */
function onKeydown(event: KeyboardEvent): void {
  if (props.stage !== 'acting') return
  const el = event.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  if (event.key === 'Enter') {
    onConfirm()
    return
  }
  const index = Number(event.key) - 1
  if (Number.isInteger(index) && index >= 0 && index < props.candidates.length) {
    onHover(props.candidates[index].championId)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="bp-panel" :class="[`is-${action}`, `stage-${stage}`]">
    <header class="bp-head">
      <span class="bp-phase">{{ action === 'ban' ? 'BAN' : 'PICK' }}</span>
      <span class="bp-status" data-test="status">{{ statusText }}</span>
      <span v-if="stage === 'acting'" class="bp-timer" :class="{ urgent: secsDisplay <= 5 }">
        {{ secsDisplay }}s
      </span>
    </header>

    <Transition name="bp-expand">
      <div v-if="stage === 'acting'" class="bp-body">
        <div class="bp-mix">
          <div v-for="side in ['ally', 'enemy'] as const" :key="side" class="bp-mix-row">
            <span class="bp-mix-side">{{ side === 'ally' ? '我方' : '敌方' }}</span>
            <div
              class="bp-mix-bar"
              :class="{ unknown: (side === 'ally' ? allyMix : enemyMix).known === 0 }"
            >
              <i
                class="seg physical"
                :style="{ width: mixWidth(side === 'ally' ? allyMix : enemyMix, 'physical') }"
              />
              <i
                class="seg magic"
                :style="{ width: mixWidth(side === 'ally' ? allyMix : enemyMix, 'magic') }"
              />
            </div>
            <span class="bp-mix-label">{{ mixLabel(side === 'ally' ? allyMix : enemyMix) }}</span>
          </div>
        </div>

        <TransitionGroup name="bp-card" tag="div" class="bp-cards">
          <button
            v-for="(c, i) in candidates"
            :key="c.championId"
            type="button"
            class="bp-card"
            :class="[
              `dmg-${c.damage}`,
              {
                'out-of-pool': !c.inPool,
                'is-hovered': c.championId === hoveredId,
                'is-auto': autoActive && c.championId === autoTargetId
              }
            ]"
            :data-test="`card-${c.championId}`"
            @click="onHover(c.championId)"
          >
            <img class="bp-card-art" :src="c.splash || c.icon" alt="" loading="lazy" />
            <span class="bp-card-shade" />

            <span class="bp-card-top">
              <span class="bp-key">{{ i + 1 }}</span>
              <span v-if="!c.inPool" class="bp-badge-out">池外</span>
              <span v-if="c.championId === hoveredId" class="bp-check">✓</span>
            </span>

            <span v-if="autoActive && c.championId === autoTargetId" class="bp-auto">
              <svg class="bp-ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle class="rail" cx="18" cy="18" r="15.5" />
                <circle
                  class="fill"
                  cx="18"
                  cy="18"
                  r="15.5"
                  :stroke-dasharray="RING_LEN"
                  :stroke-dashoffset="RING_LEN * (1 - ringRatio)"
                />
              </svg>
              <span class="bp-auto-secs">{{ secsDisplay }}</span>
              <span class="bp-auto-text">将自动{{ verb }}</span>
            </span>

            <span class="bp-card-main">
              <span class="bp-name">{{ c.name }}</span>
              <span class="bp-headline">{{ c.headline }}</span>
              <span class="bp-caption">{{ c.caption }}</span>
              <span v-if="c.mastery" class="bp-mastery" :class="{ unfamiliar: c.unfamiliar }">
                {{ c.mastery }}
              </span>
              <span class="bp-reasons">
                <span
                  v-for="r in c.reasons"
                  :key="r.kind + r.label"
                  class="bp-reason"
                  :class="{
                    pos: (r.delta ?? 0) > 0,
                    neg: (r.delta ?? 0) < 0
                  }"
                >
                  <i>{{ REASON_ICON[r.kind] }}</i>
                  {{ r.label }}
                  <b v-if="r.delta !== undefined">{{ formatDelta(r.delta) }}</b>
                </span>
              </span>
              <span v-if="c.warning" class="bp-warning">{{ c.warning }}</span>
            </span>
          </button>
        </TransitionGroup>

        <footer class="bp-foot">
          <n-select
            class="bp-search"
            :value="null"
            :options="championOptions"
            filterable
            size="small"
            placeholder="搜索其他英雄"
            @update:value="(id: number) => onHover(id)"
          />
          <span class="bp-hint">数字键预选 · 回车{{ confirmVerb }}</span>
          <button
            type="button"
            class="bp-confirm"
            data-test="confirm"
            :disabled="!hoveredId"
            @click="onConfirm"
          >
            {{ hoveredId ? `${confirmVerb} ${hoveredName}` : `先${verb}一个英雄` }}
          </button>
        </footer>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.bp-panel {
  /* 主题色：pick 蓝、ban 红；伤害类型色只用于卡片描边与构成条 */
  --bp-accent: var(--accent-blue);
  --bp-physical: var(--accent-gold-deep);
  --bp-magic: #a78bfa;
  position: relative;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--bp-accent) 35%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--bp-accent) 14%, transparent), transparent 55%),
    var(--bg-elevated);
  box-shadow:
    var(--shadow-lg),
    0 0 28px color-mix(in srgb, var(--bp-accent) calc(14% * var(--fx-glow)), transparent);
  overflow: hidden;
  transition:
    border-color var(--dur-slow) ease,
    box-shadow var(--dur-slow) ease,
    background var(--dur-slow) ease;
}

.bp-panel.is-ban {
  --bp-accent: var(--semantic-loss-bright);
}

.bp-panel.stage-waiting,
.bp-panel.stage-done {
  box-shadow: var(--shadow-sm);
}

.bp-head {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-10) var(--space-16);
}

.bp-phase {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-pill);
  color: var(--bg-base);
  background: var(--bp-accent);
}

.bp-status {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bp-timer {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  font-variant-numeric: tabular-nums;
  color: var(--bp-accent);
}

.bp-timer.urgent {
  color: var(--semantic-loss-bright);
  animation: bp-pulse 1s ease-in-out infinite;
}

.bp-body {
  padding: 0 var(--space-16) var(--space-16);
}

/* —— 伤害构成条 —— */
.bp-mix {
  display: grid;
  gap: var(--space-6);
  margin-bottom: var(--space-12);
}

.bp-mix-row {
  display: grid;
  grid-template-columns: 36px 1fr 150px;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.bp-mix-bar {
  display: flex;
  height: 6px;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--track-bg);
}

.bp-mix-bar .seg {
  display: block;
  height: 100%;
  transition: width var(--dur-slow) var(--ease-expo);
}

.bp-mix-bar .physical {
  background: var(--bp-physical);
}

.bp-mix-bar .magic {
  background: var(--bp-magic);
}

.bp-mix-bar.unknown .seg {
  background: var(--progress-rail);
}

.bp-mix-label {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}

/* —— 卡片 —— */
.bp-cards {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-10);
}

.bp-card {
  --card-edge: var(--glass-border);
  position: relative;
  height: 250px;
  padding: 0;
  border-radius: var(--radius-md);
  border: 1px solid var(--card-edge);
  background: var(--bg-base);
  color: #fff;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition:
    transform var(--dur-normal) var(--ease-expo),
    border-color var(--dur-fast) ease,
    box-shadow var(--dur-normal) ease;
}

.bp-card.dmg-physical {
  --card-edge: color-mix(in srgb, var(--bp-physical) 55%, transparent);
}

.bp-card.dmg-magic {
  --card-edge: color-mix(in srgb, var(--bp-magic) 55%, transparent);
}

.bp-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
}

.bp-card:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.bp-card.is-hovered {
  border-color: var(--bp-accent);
  box-shadow:
    0 0 0 1px var(--bp-accent),
    0 0 22px color-mix(in srgb, var(--bp-accent) calc(45% * var(--fx-glow)), transparent);
}

/* 池外：虚线描边 + 立绘降饱和，表达「可以考虑，但不是你的英雄」 */
.bp-card.out-of-pool {
  border-style: dashed;
}

.bp-card.out-of-pool .bp-card-art {
  filter: saturate(0.55);
}

.bp-card-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 18%;
  transition: transform var(--dur-slow) var(--ease-expo);
}

.bp-card:hover .bp-card-art {
  transform: scale(1.06);
}

.bp-card-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.35) 0%,
    transparent 28%,
    rgba(8, 8, 12, 0.82) 58%,
    rgba(8, 8, 12, 0.96) 100%
  );
}

.bp-card-top {
  position: absolute;
  top: var(--space-6);
  left: var(--space-6);
  right: var(--space-6);
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.bp-key {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-control);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.25); /* theme-fixed: 叠在立绘暗色遮罩上，两主题一致 */
}

.bp-badge-out {
  font-size: var(--font-size-2xs);
  padding: 1px var(--space-6);
  border-radius: var(--radius-pill);
  border: 1px dashed rgba(255, 255, 255, 0.55); /* theme-fixed: 叠在立绘暗色遮罩上，两主题一致 */
  background: rgba(0, 0, 0, 0.55);
}

.bp-check {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--bg-base);
  background: var(--bp-accent);
}

/* 自动执行目标：倒计时环 */
.bp-auto {
  position: absolute;
  top: 34px;
  left: var(--space-6);
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: 2px var(--space-8) 2px 2px;
  border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.62);
  font-size: var(--font-size-xs);
}

.bp-ring {
  width: 26px;
  height: 26px;
  transform: rotate(-90deg);
}

.bp-ring circle {
  fill: none;
  stroke-width: 3;
}

.bp-ring .rail {
  stroke: rgba(255, 255, 255, 0.18); /* theme-fixed: 叠在立绘暗色遮罩上，两主题一致 */
}

.bp-ring .fill {
  stroke: var(--bp-accent);
  stroke-linecap: round;
  transition: stroke-dashoffset 1s linear;
}

.bp-auto-secs {
  position: absolute;
  left: 2px;
  width: 26px;
  text-align: center;
  font-weight: var(--font-weight-bold);
  font-variant-numeric: tabular-nums;
}

.bp-card-main {
  position: absolute;
  left: var(--space-10);
  right: var(--space-10);
  bottom: var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.bp-name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}

.bp-headline {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-tight);
  font-variant-numeric: tabular-nums;
}

.bp-caption {
  font-size: var(--font-size-2xs);
  color: rgba(255, 255, 255, 0.55); /* theme-fixed: 叠在立绘暗色遮罩上，两主题一致 */
}

.bp-mastery {
  font-size: var(--font-size-xs);
  color: rgba(255, 255, 255, 0.75); /* theme-fixed: 叠在立绘暗色遮罩上，两主题一致 */
}

.bp-mastery.unfamiliar {
  color: var(--semantic-warn);
}

.bp-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.bp-reason {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px var(--space-6);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-2xs);
  background: rgba(255, 255, 255, 0.1); /* theme-fixed: 叠在立绘暗色遮罩上，两主题一致 */
  white-space: nowrap;
}

.bp-reason i {
  font-style: normal;
  opacity: 0.7;
}

.bp-reason b {
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.bp-reason.pos b {
  color: var(--semantic-win-bright);
}

.bp-reason.neg b {
  color: var(--semantic-loss-bright);
}

.bp-warning {
  margin-top: var(--space-4);
  font-size: var(--font-size-2xs);
  color: var(--semantic-warn);
}

/* —— 底部操作区 —— */
.bp-foot {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  margin-top: var(--space-12);
}

.bp-search {
  width: 180px;
}

.bp-hint {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.bp-confirm {
  min-width: 160px;
  padding: var(--space-8) var(--space-20);
  border: 0;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--bg-base);
  background: var(--bp-accent);
  cursor: pointer;
  box-shadow: 0 0 18px color-mix(in srgb, var(--bp-accent) calc(40% * var(--fx-glow)), transparent);
  transition:
    transform var(--dur-fast) ease,
    filter var(--dur-fast) ease;
}

.bp-confirm:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
}

.bp-confirm:disabled {
  cursor: not-allowed;
  color: var(--text-tertiary);
  background: var(--surface-control);
  box-shadow: none;
}

/* —— 动效 —— */
.bp-card-move {
  transition: transform var(--dur-slow) var(--ease-expo);
}

.bp-card-enter-active,
.bp-card-leave-active {
  transition:
    opacity var(--dur-normal) ease,
    transform var(--dur-normal) var(--ease-expo);
}

.bp-card-enter-from,
.bp-card-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

/* 离场卡片脱离网格流，剩余卡片才能用 move 过渡补位 */
.bp-card-leave-active {
  position: absolute;
}

.bp-expand-enter-active,
.bp-expand-leave-active {
  transition:
    opacity var(--dur-normal) ease,
    transform var(--dur-spring) var(--ease-expo);
}

.bp-expand-enter-from,
.bp-expand-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@keyframes bp-pulse {
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bp-card,
  .bp-card-art,
  .bp-card-move,
  .bp-ring .fill {
    transition: none;
  }

  .bp-timer.urgent {
    animation: none;
  }
}
</style>
