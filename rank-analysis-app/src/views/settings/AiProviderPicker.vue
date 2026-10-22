<!--
  AI 服务提供方选择：阿里云 DeepSeek（默认）/ Claude Opus 5.5（经 Oracle 中转）。

  Claude 受 Anthropic 服务地区限制：挂载时经中转按出口 IP 检测，不可用则卡片置灰；
  已选 Claude 但地区不可用时 resolveModel 会静默回落 DeepSeek，这里给出提示。
  选中 Claude 时带流光边框 + 粒子迸发特效（prefers-reduced-motion 下关闭）。
-->
<template>
  <div class="provider-picker">
    <div class="cards">
      <button
        type="button"
        class="card card--ds"
        :class="{ 'is-active': provider === 'dashscope' }"
        @click="select('dashscope')"
      >
        <span class="card__title">DeepSeek</span>
        <span class="card__sub">阿里云百炼 · 快速稳定</span>
      </button>

      <button
        ref="claudeCard"
        type="button"
        class="card card--claude"
        :class="{
          'is-active': provider === 'claude',
          'is-disabled': !claudeAvailable,
          'is-bursting': bursting
        }"
        :aria-disabled="!claudeAvailable"
        @click="select('claude')"
        @pointermove="trackPointer"
      >
        <span class="card__spotlight" aria-hidden="true" />
        <span class="card__title card__title--shine">Claude Opus 5.5</span>
        <span class="card__sub">Anthropic · 理解力最强</span>
        <span class="region" :class="`region--${regionState}`">
          <span class="region__dot" />
          {{ regionText }}
        </span>
        <span v-if="bursting" class="sparks" aria-hidden="true">
          <i v-for="n in SPARK_COUNT" :key="n" :style="sparkStyle(n)" />
        </span>
      </button>
    </div>

    <n-text v-if="provider === 'claude' && region && !region.allowed" :depth="3" class="hint warn">
      当前地区暂不可用 Claude，AI 分析会自动使用 DeepSeek。
    </n-text>
    <n-text v-else-if="!claudeAvailable && region" :depth="3" class="hint">
      Claude 仅在 Anthropic 提供服务的地区可用（按当前网络出口判定）。
      <a class="recheck" @click="detect(true)">重新检测</a>
    </n-text>

    <template v-if="provider === 'claude'">
      <n-input
        v-model:value="anthropicKey"
        type="password"
        show-password-on="click"
        placeholder="留空使用官方内置 Key"
        @blur="saveKey(CONFIG_KEYS.anthropicApiKey, anthropicKey)"
      />
      <n-text :depth="3" class="hint">
        填入你自己的 Anthropic API Key 则走你的额度、不受内置限额约束；留空使用官方内置 Key。
      </n-text>
    </template>
    <template v-else>
      <n-input
        v-model:value="dashscopeKey"
        type="password"
        show-password-on="click"
        placeholder="留空使用内置 Key"
        @blur="saveKey(CONFIG_KEYS.dashscopeApiKey, dashscopeKey)"
      />
      <n-text :depth="3" class="hint">
        填入你自己的 DashScope (阿里云百炼) API Key 则走你的额度；留空使用内置 Key。
      </n-text>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { checkClaudeRegion } from '@renderer/services/ai/modelConfig'
import type { AiProvider, ClaudeRegion } from '@renderer/services/ai/modelConfig'

/** 粒子数量：再多在低端机上会掉帧 */
const SPARK_COUNT = 16
/** 粒子动画时长（ms），与 CSS 的 spark-fly 一致 */
const BURST_MS = 900

const message = useMessage()
const provider = ref<AiProvider>('dashscope')
const region = ref<ClaudeRegion | null>(null)
const detecting = ref(false)
const anthropicKey = ref('')
const dashscopeKey = ref('')
const bursting = ref(false)
const claudeCard = ref<HTMLElement | null>(null)

const claudeAvailable = computed(() => region.value?.allowed === true)

const regionState = computed(() => {
  if (detecting.value || !region.value) return 'pending'
  if (region.value.error) return 'error'
  return region.value.allowed ? 'ok' : 'blocked'
})

const regionText = computed(() => {
  const r = region.value
  switch (regionState.value) {
    case 'pending':
      return '检测地区中…'
    case 'error':
      return '地区检测失败'
    case 'ok':
      return `可用 · ${r?.country}`
    default:
      return `当前地区不可用 · ${r?.country ?? '未知'}`
  }
})

/**
 * 检测 Claude 区域可用性
 * @param force - 跳过 Rust 侧缓存（用户手动重测）
 */
async function detect(force = false) {
  detecting.value = true
  try {
    region.value = await checkClaudeRegion(force)
  } finally {
    detecting.value = false
  }
}

onMounted(async () => {
  const [p, ak, dk] = await Promise.all([
    getConfigByIpc<string>(CONFIG_KEYS.aiProvider).catch(() => undefined),
    getConfigByIpc<string>(CONFIG_KEYS.anthropicApiKey).catch(() => undefined),
    getConfigByIpc<string>(CONFIG_KEYS.dashscopeApiKey).catch(() => undefined)
  ])
  provider.value = p === 'claude' ? 'claude' : 'dashscope'
  if (typeof ak === 'string') anthropicKey.value = ak
  if (typeof dk === 'string') dashscopeKey.value = dk
  await detect()
})

async function select(next: AiProvider) {
  if (next === provider.value) return
  if (next === 'claude' && !claudeAvailable.value) {
    message.warning(
      region.value?.error ? 'Claude 地区检测失败，请稍后重试' : '当前地区暂不可用 Claude'
    )
    return
  }
  try {
    await putConfigByIpc(CONFIG_KEYS.aiProvider, next)
    provider.value = next
    if (next === 'claude') burst()
    message.success(next === 'claude' ? '已切换到 Claude Opus 5.5' : '已切换到 DeepSeek')
  } catch {
    message.error('保存失败')
  }
}

async function saveKey(key: string, value: string) {
  try {
    await putConfigByIpc(key, value.trim())
    message.success('设置已保存')
  } catch {
    message.error('保存失败')
  }
}

/** 选中 Claude 的粒子迸发：重置后重新挂载粒子节点以重播动画 */
function burst() {
  bursting.value = false
  requestAnimationFrame(() => {
    bursting.value = true
    setTimeout(() => (bursting.value = false), BURST_MS)
  })
}

/** 每颗粒子的飞散方向与距离（均匀分布角度 + 少量抖动） */
function sparkStyle(n: number) {
  const angle = (360 / SPARK_COUNT) * n + (n % 3) * 7
  const dist = 70 + (n % 4) * 18
  return { '--angle': `${angle}deg`, '--dist': `${dist}px`, '--delay': `${(n % 5) * 30}ms` }
}

/** 鼠标跟随的聚光效果 */
function trackPointer(e: PointerEvent) {
  const el = claudeCard.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
  el.style.setProperty('--my', `${e.clientY - rect.top}px`)
}
</script>

<style scoped>
/* 流光边框的角度要能被动画插值，必须注册成 <angle> 类型 */
@property --spin {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.provider-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: 100%;
  max-width: 520px;
}

.cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-10);
}

.card {
  --claude: #d97757;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-12);
  border: 1px solid var(--border-control);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  overflow: visible;
  transition:
    border-color 0.2s,
    transform 0.2s,
    box-shadow 0.3s;
}

.card:hover:not(.is-disabled) {
  border-color: var(--border-control-hover);
  transform: translateY(-1px);
}

.card__title {
  font-size: var(--font-size-md);
  font-weight: 600;
}

.card__sub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.card--ds.is-active {
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 1px var(--accent-blue) inset;
}

/* ---- Claude 卡片 ---- */
.card--claude {
  isolation: isolate;
}

/* 鼠标跟随聚光 */
.card__spotlight {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    160px circle at var(--mx, 50%) var(--my, 50%),
    rgba(217, 119, 87, 0.18),
    transparent 70%
  );
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: -1;
}

.card--claude:hover:not(.is-disabled) .card__spotlight {
  opacity: 1;
}

/* 选中：旋转的流光边框 + 呼吸辉光 */
.card--claude.is-active {
  border-color: transparent;
  background:
    linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,
    conic-gradient(
        from var(--spin),
        var(--claude),
        var(--accent-gold),
        #b48cff,
        var(--accent-sky),
        var(--claude)
      )
      border-box;
  border-width: 2px;
  padding: calc(var(--space-12) - 1px);
  animation:
    border-spin 4s linear infinite,
    glow-breathe 2.6s ease-in-out infinite;
}

.card--claude.is-active::after {
  /* 外层柔光：同一圈渐变模糊后垫在卡片下面 */
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  background: conic-gradient(
    from var(--spin),
    var(--claude),
    var(--accent-gold),
    #b48cff,
    var(--accent-sky),
    var(--claude)
  );
  filter: blur(14px);
  /* 亮色主题下白底光晕读作污渍，随 --fx-glow 关掉；流光边框与粒子保留 */
  opacity: calc(0.45 * var(--fx-glow));
  z-index: -2;
  animation: border-spin 4s linear infinite;
}

/* 标题流光文字 */
.card--claude.is-active .card__title--shine {
  background: linear-gradient(
    100deg,
    var(--claude) 20%,
    #ffe2c6 40%,
    var(--accent-gold) 55%,
    var(--claude) 80%
  );
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: text-shine 3s linear infinite;
}

.card--claude.is-disabled {
  cursor: not-allowed;
  filter: grayscale(0.85);
  opacity: 0.55;
}

/* 选中瞬间的弹跳 */
.card--claude.is-bursting {
  animation:
    border-spin 4s linear infinite,
    pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 粒子 */
.sparks {
  position: absolute;
  left: 50%;
  top: 50%;
  pointer-events: none;
}

.sparks i {
  position: absolute;
  width: 6px;
  height: 6px;
  margin: -3px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0%, var(--accent-gold) 45%, var(--claude) 100%);
  box-shadow: 0 0 8px var(--accent-gold); /* theme-fixed：粒子一闪即逝，不读作污渍 */
  opacity: 0;
  animation: spark-fly 0.9s cubic-bezier(0.15, 0.7, 0.3, 1) var(--delay) forwards;
}

.sparks i:nth-child(even) {
  width: 4px;
  height: 4px;
  background: #b48cff;
  box-shadow: 0 0 6px #b48cff; /* theme-fixed：粒子一闪即逝，不读作污渍 */
}

/* 地区徽标 */
.region {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-4);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.region__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.region--ok .region__dot {
  background: var(--semantic-win);
  box-shadow: 0 0 6px var(--semantic-win);
}

.region--blocked .region__dot,
.region--error .region__dot {
  background: var(--semantic-warn);
}

.region--pending .region__dot {
  animation: blink 1s ease-in-out infinite;
}

.hint {
  font-size: var(--font-size-sm);
}

.hint.warn {
  color: var(--semantic-warn);
}

.recheck {
  margin-left: var(--space-4);
  color: var(--accent-blue);
  cursor: pointer;
}

@keyframes border-spin {
  to {
    --spin: 360deg;
  }
}

@keyframes glow-breathe {
  0%,
  100% {
    box-shadow: 0 0 12px color-mix(in srgb, var(--claude) calc(25% * var(--fx-glow)), transparent);
  }
  50% {
    box-shadow: 0 0 26px
      color-mix(in srgb, var(--accent-gold) calc(40% * var(--fx-glow)), transparent);
  }
}

@keyframes text-shine {
  to {
    background-position: -220% 0;
  }
}

@keyframes pop {
  0% {
    transform: scale(0.96);
  }
  60% {
    transform: scale(1.04);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes spark-fly {
  0% {
    opacity: 1;
    transform: rotate(var(--angle)) translateX(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(var(--dist)) scale(0.2);
  }
}

@keyframes blink {
  50% {
    opacity: 0.3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card--claude.is-active,
  .card--claude.is-active::after,
  .card--claude.is-active .card__title--shine,
  .card--claude.is-bursting,
  .region--pending .region__dot {
    animation: none;
  }

  .sparks {
    display: none;
  }
}
</style>
