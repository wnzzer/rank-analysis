<script setup lang="ts">
/**
 * 赛后右下角弹卡的卡片本体（纯展示；数据与窗口行为在 views/PostGameToast.vue）。
 *
 * 视觉见 spec 2026-11-19-postgame-toast-design.md §视觉：英雄原画打底、左侧压暗渐变，
 * 口吻色与战报图一致；动效全部一次性（进场上滑、Carry 高光扫一次、底部倒计时条）。
 *
 * 三种状态：
 * - loading：复盘还在算，只有胜负 / KDA / LP 一行 +「看完整战报」；
 * - guess：还没标注——不露 AI 结论，直接在卡上点头像猜：先选最关键，再选最犯罪，
 *   选完发 submit（两项都可跳过）。不跳主窗口：弹卡出现时玩家在客户端里，
 *   为了猜一下把主窗口拉到前台太重了；
 * - revealed：已标注（或本队列无标注卡）——标签 + 一条事实，主按钮「复制战报图」。
 *
 * 无交互 ttlMs 后发 expire；鼠标悬停期间暂停倒计时。
 * @property state - 当前状态
 * @property win / champion / kda / lpText - 顶行
 * @property label / tone / tagline / headline - 揭晓后的标签与事实
 * @property splashUrl / iconUrl - 原画（打底）与头像（原画缺失时的兜底）
 * @property allies / enemies - 双方玩家（guess 状态的头像排，己方在左）
 * @property compare - 揭晓后「你 vs AI」的一行对比；没猜过为 null
 * @property copyState - 复制按钮状态
 * @property ttlMs - 自动关闭时长；0 不自动关
 * @emits submit - 猜完（或两项都跳过）；payload 为所选玩家的 participantId，跳过为 null
 * @emits open / copy / close / expire
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ShareTone } from '@renderer/services/ai/review/shareFacts'

export type ToastState = 'loading' | 'guess' | 'revealed'
export type ToastCopyState = 'idle' | 'copying' | 'copied' | 'failed'

/**
 * 头像排里的一名玩家
 * @property pid - participantId
 * @property url - 英雄头像
 * @property name - 英雄名（悬停提示）
 */
export interface ToastAvatar {
  pid: number
  url: string
  name?: string
}

/** 玩家的猜测：所选玩家的 participantId，跳过为 null */
export interface ToastGuess {
  keyPid: number | null
  blamePid: number | null
}

const props = withDefaults(
  defineProps<{
    state: ToastState
    win: boolean
    champion: string
    kda: string
    lpText?: string | null
    label?: string | null
    tone?: ShareTone
    tagline?: string | null
    headline?: string | null
    splashUrl?: string | null
    iconUrl?: string | null
    allies?: ToastAvatar[]
    enemies?: ToastAvatar[]
    compare?: string | null
    copyState?: ToastCopyState
    ttlMs?: number
  }>(),
  {
    lpText: null,
    label: null,
    tone: 'neutral',
    tagline: null,
    headline: null,
    splashUrl: null,
    iconUrl: null,
    allies: () => [],
    enemies: () => [],
    compare: null,
    copyState: 'idle',
    ttlMs: 25_000
  }
)

const emit = defineEmits<{
  (e: 'submit', guess: ToastGuess): void
  (e: 'open'): void
  (e: 'copy'): void
  (e: 'close'): void
  (e: 'expire'): void
}>()

/** 原画加载失败时退回头像兜底 */
const splashBroken = ref(false)
const showSplash = computed(() => !!props.splashUrl && !splashBroken.value)

const copyText = computed(
  () =>
    ({
      idle: '复制战报图',
      copying: '生成中…',
      copied: '已复制，去群里粘贴',
      failed: '复制失败，再试一次'
    })[props.copyState]
)

// ── 猜：先最关键、再最犯罪，两步各点一个头像（或跳过），第二步结束即提交 ──
const step = ref<'key' | 'blame'>('key')
const keyPid = ref<number | null>(null)

function choose(pid: number | null): void {
  if (step.value === 'key') {
    keyPid.value = pid
    step.value = 'blame'
    return
  }
  emit('submit', { keyPid: keyPid.value, blamePid: pid })
}

/** 退回上一步重选最关键 */
function back(): void {
  step.value = 'key'
  keyPid.value = null
}

// 换了一局（或状态被外部重置回 guess）时从头开始
watch(
  () => props.state,
  s => {
    if (s === 'guess') back()
  }
)

// ── 自动关闭倒计时：rAF 不可靠（窗口刚 show 时可能暂停），用定时器 + 剩余时长 ──
const remaining = ref(props.ttlMs)
const paused = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let startedAt = 0

function startTimer(): void {
  if (!props.ttlMs || timer || remaining.value <= 0) return
  startedAt = Date.now()
  timer = setTimeout(() => {
    timer = null
    remaining.value = 0
    emit('expire')
  }, remaining.value)
}

function stopTimer(): void {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  remaining.value = Math.max(0, remaining.value - (Date.now() - startedAt))
}

function onEnter(): void {
  paused.value = true
  stopTimer()
}

function onLeave(): void {
  paused.value = false
  startTimer()
}

onMounted(startTimer)
onBeforeUnmount(stopTimer)

/**
 * 倒计时条：一条时长 = ttlMs 的 CSS 动画，悬停时与定时器一起暂停，两者始终同步
 * （不随 remaining 改 duration：改 duration 会让进行中的动画按新时长重算进度、跳一下）
 */
const barStyle = computed(() => ({
  animationDuration: `${props.ttlMs}ms`,
  animationPlayState: paused.value ? 'paused' : 'running'
}))
</script>

<template>
  <div
    class="pgt-card"
    :class="[`tone-${tone}`, `state-${state}`]"
    data-test="pgt-card"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <img
      v-if="showSplash"
      class="pgt-splash"
      :src="splashUrl!"
      alt=""
      data-test="pgt-splash"
      @error="splashBroken = true"
    />
    <img v-else-if="iconUrl" class="pgt-fallback-icon" :src="iconUrl" alt="" />
    <div class="pgt-shade" />

    <div class="pgt-content">
      <div class="pgt-top">
        <span class="pgt-result" :class="win ? 'is-win' : 'is-loss'">{{
          win ? '胜利' : '失败'
        }}</span>
        <span class="pgt-champ">{{ champion }}</span>
        <span class="pgt-num">{{ kda }}</span>
        <span v-if="lpText" class="pgt-num pgt-lp" :class="win ? 'is-win' : 'is-loss'">{{
          lpText
        }}</span>
        <button
          class="pgt-close"
          type="button"
          aria-label="关闭"
          data-test="pgt-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <template v-if="state === 'guess'">
        <div class="pgt-main" data-test="pgt-guess-text">
          <template v-if="step === 'key'">
            你觉得谁是本局 <span class="pgt-key">最关键</span> 的人？
          </template>
          <template v-else>那谁 <span class="pgt-blame">最犯罪</span>？</template>
        </div>
        <div class="pgt-sub">点头像选一个 · 选完揭晓 AI 的判断</div>
        <div class="pgt-lineup" data-test="pgt-lineup">
          <template v-for="(team, ti) in [allies, enemies]" :key="ti">
            <span v-if="ti === 1" class="pgt-vs">VS</span>
            <button
              v-for="a in team"
              :key="a.pid"
              type="button"
              class="pgt-mini"
              :class="{ 'is-key': keyPid === a.pid }"
              :title="a.name"
              :data-test="`pgt-pick-${a.pid}`"
              @click="choose(a.pid)"
            >
              <img :src="a.url" alt="" />
            </button>
          </template>
        </div>
      </template>

      <template v-else-if="state === 'revealed'">
        <div class="pgt-verdict">
          <span
            v-if="label"
            class="pgt-label"
            :class="{ 'is-carry': label === 'Carry' }"
            data-test="pgt-label"
            >{{ label }}</span
          >
          <span v-if="tagline" class="pgt-tagline">{{ tagline }}</span>
        </div>
        <div v-if="headline" class="pgt-fact" data-test="pgt-headline">{{ headline }}</div>
        <div v-if="compare" class="pgt-compare" data-test="pgt-compare">{{ compare }}</div>
      </template>

      <template v-else>
        <div class="pgt-main pgt-pending">AI 复盘生成中…</div>
        <div class="pgt-skeleton" />
      </template>

      <div class="pgt-actions">
        <template v-if="state === 'guess'">
          <button class="pgt-btn is-ghost" type="button" data-test="pgt-skip" @click="choose(null)">
            {{ step === 'key' ? '跳过这项' : '没有 / 跳过' }}
          </button>
          <button
            v-if="step === 'blame'"
            class="pgt-btn is-ghost"
            type="button"
            data-test="pgt-back"
            @click="back"
          >
            重选
          </button>
        </template>
        <button
          v-else-if="state === 'revealed'"
          class="pgt-btn is-primary"
          :class="{ 'is-done': copyState === 'copied' }"
          type="button"
          :disabled="copyState === 'copying'"
          data-test="pgt-copy"
          @click="emit('copy')"
        >
          {{ copyText }}
        </button>
        <button class="pgt-btn is-ghost" type="button" data-test="pgt-open" @click="emit('open')">
          看完整战报
        </button>
      </div>
    </div>

    <div v-if="ttlMs" class="pgt-timer" :style="barStyle" data-test="pgt-timer" />
  </div>
</template>

<style scoped>
.pgt-card {
  --pgt-accent: #b4bccb;
  --pgt-bg: #0b0e14;
  --pgt-text: #f1f3f8;
  --pgt-sub: rgba(241, 243, 248, 0.68);
  --pgt-win: #4cc38a;
  --pgt-loss: #f0595e;
  /* 白色叠层：弹卡配色固定在深色，不跟主题 */
  --pgt-w04: rgba(255, 255, 255, 0.04); /* theme-fixed */
  --pgt-w06: rgba(255, 255, 255, 0.06); /* theme-fixed */
  --pgt-w10: rgba(255, 255, 255, 0.1); /* theme-fixed */
  --pgt-w12: rgba(255, 255, 255, 0.12); /* theme-fixed */
  --pgt-w16: rgba(255, 255, 255, 0.16); /* theme-fixed */
  --pgt-w72: rgba(255, 255, 255, 0.72); /* theme-fixed */
  --pgt-num: 'Oswald', 'Bahnschrift', 'DIN Alternate', sans-serif;
  position: relative;
  box-sizing: border-box;
  width: 340px;
  height: 184px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--pgt-bg);
  color: var(--pgt-text);
  font-family: 'Microsoft YaHei UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--pgt-accent) 35%, transparent),
    0 12px 32px rgba(0, 0, 0, 0.45);
  user-select: none;
  animation: pgt-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.tone-brag {
  --pgt-accent: #f5b544;
}
.tone-vindicate {
  --pgt-accent: #6cb6ff;
}
.tone-neutral {
  --pgt-accent: #b4bccb;
}
.tone-roast {
  --pgt-accent: #ff7a59;
}
/* 未揭晓：用中性的冷色，不暗示结论 */
.state-guess,
.state-loading {
  --pgt-accent: #8fa8ff;
}

@keyframes pgt-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ── 底图 ── */
.pgt-splash {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 70% 30%;
}
.pgt-fallback-icon {
  position: absolute;
  right: -18px;
  top: 50%;
  width: 150px;
  height: 150px;
  transform: translateY(-50%);
  border-radius: 50%;
  opacity: 0.55;
  filter: saturate(1.1);
}
.pgt-shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, var(--pgt-bg) 0%, rgba(11, 14, 20, 0.86) 42%, rgba(11, 14, 20, 0) 78%),
    linear-gradient(0deg, rgba(11, 14, 20, 0.75) 0%, rgba(11, 14, 20, 0) 45%),
    radial-gradient(
      90% 120% at 100% 0%,
      color-mix(in srgb, var(--pgt-accent) 22%, transparent),
      transparent 60%
    );
}

/* ── 内容 ── */
.pgt-content {
  position: relative;
  height: 100%;
  box-sizing: border-box;
  padding: 12px 14px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pgt-top {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 20px;
}
.pgt-result {
  padding: 0 8px;
  border-radius: 999px;
  font-weight: 700;
  letter-spacing: 1.5px;
}
.pgt-result.is-win {
  color: #d9ffe9;
  background: color-mix(in srgb, var(--pgt-win) 40%, transparent);
}
.pgt-result.is-loss {
  color: #ffe1e2;
  background: color-mix(in srgb, var(--pgt-loss) 40%, transparent);
}
.pgt-champ {
  font-weight: 600;
}
.pgt-num {
  font-family: var(--pgt-num);
  font-size: 13px;
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
  color: var(--pgt-sub);
}
.pgt-lp.is-win {
  color: var(--pgt-win);
}
.pgt-lp.is-loss {
  color: var(--pgt-loss);
}
.pgt-close {
  margin-left: auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--pgt-text);
  font-size: 11px;
  opacity: 0.4;
  cursor: pointer;
  transition:
    opacity 120ms,
    background 120ms;
}
.pgt-card:hover .pgt-close {
  opacity: 0.85;
}
.pgt-close:hover {
  background: var(--pgt-w12);
  opacity: 1;
}

.pgt-main {
  margin-top: 4px;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
}
.pgt-key {
  color: #f5b544;
}
.pgt-blame {
  color: #ff7a59;
}
.pgt-sub {
  font-size: 12px;
  color: var(--pgt-sub);
}
.pgt-pending {
  color: var(--pgt-sub);
  font-weight: 600;
}
.pgt-skeleton {
  width: 70%;
  height: 10px;
  border-radius: 5px;
  background: linear-gradient(90deg, var(--pgt-w06), var(--pgt-w16), var(--pgt-w06));
  background-size: 200% 100%;
  animation: pgt-shimmer 1.4s ease-in-out infinite;
}
@keyframes pgt-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}

/* 头像排：十个可点的头像，己方在左。不露 AI 选了谁 */
.pgt-lineup {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}
.pgt-mini {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: var(--pgt-w06);
  box-shadow: 0 0 0 1px var(--pgt-w16);
  overflow: hidden;
  cursor: pointer;
  transition:
    transform 120ms,
    box-shadow 120ms;
}
.pgt-mini img {
  display: block;
  width: 100%;
  height: 100%;
  filter: brightness(0.82);
  transition: filter 120ms;
}
.pgt-mini:hover {
  transform: translateY(-2px) scale(1.12);
  box-shadow: 0 0 0 2px var(--pgt-accent);
}
.pgt-mini:hover img {
  filter: none;
}
/* 第一步选中的「最关键」在第二步保持金圈，提醒玩家刚才选了谁 */
.pgt-mini.is-key {
  box-shadow: 0 0 0 2px #f5b544;
}
.pgt-mini.is-key img {
  filter: none;
}
.pgt-vs {
  margin: 0 3px;
  font-family: var(--pgt-num);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--pgt-sub);
}

.pgt-verdict {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 4px;
}
.pgt-label {
  position: relative;
  overflow: hidden;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 1px;
  line-height: 1.15;
  color: var(--pgt-accent);
  text-shadow: 0 2px 14px color-mix(in srgb, var(--pgt-accent) 45%, transparent);
}
.pgt-label.is-carry {
  background: linear-gradient(
    100deg,
    #f5b544 0%,
    #f5b544 40%,
    #fff6dc 50%,
    #f5b544 60%,
    #f5b544 100%
  );
  background-size: 300% 100%;
  background-position: 100% 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: none;
  filter: drop-shadow(0 2px 10px rgba(245, 181, 68, 0.45));
  /* 高光扫一次：进场后 200ms 开始 */
  animation: pgt-sweep 600ms ease-out 200ms 1 both;
}
@keyframes pgt-sweep {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0% 0;
  }
}
.pgt-tagline {
  font-size: 13px;
  font-weight: 600;
}
.pgt-fact {
  max-width: 230px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--pgt-text);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}

.pgt-compare {
  max-width: 250px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--pgt-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 按钮 ── */
.pgt-actions {
  margin-top: auto;
  display: flex;
  gap: 8px;
}
.pgt-btn {
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    filter 120ms,
    background 120ms,
    color 120ms;
}
.pgt-btn.is-primary {
  border: none;
  color: #10131a;
  background: var(--pgt-accent);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--pgt-accent) 35%, transparent);
}
.pgt-btn.is-primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.pgt-btn.is-primary.is-done {
  background: var(--pgt-win);
}
.pgt-btn:disabled {
  cursor: default;
  opacity: 0.75;
}
.pgt-btn.is-ghost {
  border: 1px solid var(--pgt-w16);
  color: var(--pgt-w72);
  background: var(--pgt-w04);
}
.pgt-btn.is-ghost:hover {
  color: #fff;
  background: var(--pgt-w10);
}

/* ── 倒计时条 ── */
.pgt-timer {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 2px;
  background: var(--pgt-accent);
  opacity: 0.8;
  transform-origin: left center;
  animation-name: pgt-countdown;
  animation-timing-function: linear;
  animation-fill-mode: both;
}
@keyframes pgt-countdown {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pgt-card {
    animation-name: pgt-fade;
  }
  .pgt-label.is-carry {
    animation: none;
    background-position: 50% 0;
  }
  .pgt-skeleton {
    animation: none;
  }
}
@keyframes pgt-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
