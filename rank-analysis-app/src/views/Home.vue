<template>
  <div class="home">
    <!-- ===== 沉浸层：熔炉余烬 Hero ===== -->
    <section class="hero" :class="{ 'hero--cold': !connected }">
      <canvas ref="emberCanvas" class="hero__canvas" aria-hidden="true"></canvas>
      <div class="hero__veil" aria-hidden="true"></div>

      <div class="hero__inner">
        <p class="hero__kicker reveal" style="--d: 0">
          <span class="hero__rule" aria-hidden="true"></span>
          HOME · {{ greeting }}，召唤师
        </p>

        <h1 class="hero__title reveal" style="--d: 60ms" :aria-label="titleText">
          <span
            v-for="(ch, i) in titleChars"
            :key="i"
            class="hero__ch"
            :class="{ 'hero__ch--tag': ch.char === '#' }"
            :style="{ '--d': 120 + i * 40 + 'ms' }"
            >{{ ch.char === ' ' ? '\u00A0' : ch.char }}</span
          >
        </h1>

        <div class="hero__meta reveal" style="--d: 260ms">
          <span class="pulse-dot" :class="{ 'pulse-dot--on': connected }"></span>
          <span class="hero__meta-main">{{ connected ? phaseText : offTitle }}</span>
          <span class="hero__meta-sep" aria-hidden="true">/</span>
          <span class="hero__meta-sub">{{
            connected ? '客户端运行中' : '启动后自动同步段位与战绩'
          }}</span>
        </div>
      </div>

      <div class="ticker" role="status">
        <div class="ticker__track">
          <span v-for="copy in 2" :key="copy" class="ticker__copy" :aria-hidden="copy === 2">
            <span v-for="(it, i) in tickerItems" :key="i" class="ticker__item">
              <component :is="it.icon" class="ticker__icon" />{{ it.text }}
              <Diamond class="ticker__sep" />
            </span>
          </span>
        </div>
      </div>
    </section>

    <!-- ===== 功能舱 ===== -->
    <div class="home__inner">
      <div class="home__grid home__grid--main">
        <!-- 客户端状态卡：原 /Loading 页职责并入（v2 壳层） -->
        <CornerCard
          title="客户端状态"
          :emphasis="!connected"
          class="home__status reveal"
          style="--d: 120ms"
        >
          <template #extra
            ><span v-if="connected" class="tagp win"
              ><i class="dot dot--win"></i>在线</span
            ></template
          >
          <div v-if="connected" class="st-row">
            <span class="ic ic--win"><Circle class="ic-fill" /></span>
            <div class="st-copy">
              <b>{{ summoner?.gameName }}#{{ summoner?.tagLine }}</b>
              <span class="psub">{{ phaseText }}</span>
            </div>
            <button class="btn gho sm" @click="go('Gaming')">
              <span>去对局</span><ArrowRight class="btn-arrow-glyph" />
            </button>
          </div>
          <div v-else class="home__offline">
            <p class="home__off-title">{{ offTitle }}</p>
            <p class="psub">{{ offHint }}</p>
            <div class="home__off-acts">
              <button
                v-if="canLaunch"
                class="btn pri sm"
                :disabled="launching"
                @click="launchLeague"
              >
                {{ launching ? '正在启动…' : '启动客户端' }}
              </button>
              <button
                v-if="isAccessDenied && canRelaunch"
                class="btn gho sm"
                :disabled="relaunching"
                @click="relaunchAsAdmin"
              >
                {{ relaunching ? '正在重启…' : '以管理员身份重启' }}
              </button>
            </div>
          </div>
        </CornerCard>

        <!-- 短板提醒：来自成长页的习惯标签聚合 -->
        <CornerCard
          title="短板提醒"
          subtitle="近 20 场聚合"
          emphasis
          class="home__shorts reveal"
          style="--d: 200ms"
        >
          <template #extra
            ><button class="btn gho sm" @click="go('Growth')">去成长 →</button></template
          >
          <div v-if="topTags.length" class="short-list">
            <div v-for="t in topTags" :key="t.dimension" class="short-row">
              <span class="tagp loss">{{ dimLabel(t.dimension) }} {{ fmtDelta(t.avgVsPeer) }}</span>
              <span class="short-bar" aria-hidden="true"
                ><i :style="{ width: barWidth(t.avgVsPeer) }"></i
              ></span>
              <span class="psub short-streak">持续 {{ t.streak }} 局</span>
              <button class="btn gho sm short-fix" @click="turnToGoal(t)">转为目标</button>
            </div>
          </div>
          <EmptyState
            v-else-if="!tagsLoading"
            :icon="TrendingUp"
            title="暂无短板检出"
            description="收集满 5 局对局后会自动在「成长」页产出习惯标签；届时可在这里一键转为改错目标。"
          >
            <template #action
              ><button class="btn gho sm" @click="go('Growth')">先去看看成长页</button></template
            >
          </EmptyState>
          <p v-else class="psub">正在读取短板数据…</p>
        </CornerCard>
      </div>

      <div class="home__grid home__grid--sub">
        <CornerCard title="快捷入口" class="reveal" style="--d: 280ms">
          <button class="qentry" @click="openPalette" @pointermove="tilt" @pointerleave="untilt">
            <span class="ic"><Search /></span>
            <span class="qentry__label">查询玩家战绩</span>
            <span class="kbd q-kbd">Ctrl K</span>
          </button>
          <button class="qentry" @click="goRecordSelf" @pointermove="tilt" @pointerleave="untilt">
            <span class="ic"><ScrollText /></span>
            <span class="qentry__label">查看我的战绩</span>
          </button>
          <button class="qentry" @click="go('Library')" @pointermove="tilt" @pointerleave="untilt">
            <span class="ic"><LibraryBig /></span>
            <span class="qentry__label">资产库 · 标签与标记</span>
          </button>
          <button class="qentry" @click="go('Settings')" @pointermove="tilt" @pointerleave="untilt">
            <span class="ic"><Settings /></span>
            <span class="qentry__label">设置</span>
          </button>
        </CornerCard>

        <CornerCard title="最近动态" class="reveal" style="--d: 340ms">
          <div class="qentry qentry--static">
            <span class="ic"><Sparkles /></span>
            <span class="psub">选人期推荐 / 对局信号会在进入英雄选择后自动出现在「对局」页</span>
          </div>
          <div class="qentry qentry--static">
            <span class="ic"><Columns2 /></span>
            <span class="psub">战绩子窗口支持并排对比：在战绩页打开详情后按 Ctrl+Tab 切换窗口</span>
          </div>
        </CornerCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Home —— 主页仪表盘 · 标杆展示页（设计系统 v3 §C1 + 4A 升级）
 *
 * 沉浸层：熔炉余烬粒子场（useEmberField）+ 超大逐字排版 + 动态 ticker；
 * 物理动效：入口 stagger / 快捷入口磁吸 tilt；全部尊重 prefers-reduced-motion。
 *
 * 功能契约不变：
 * - 原 /Loading 的连接门职责并入「客户端状态卡」（含一键启动 / 管理员重启）；
 * - 成长短板 Top3 直达转化（转目标）；
 * - 快捷入口统一走 CommandPalette / 路由，不重复业务逻辑。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'

import CornerCard from '../components/ui/CornerCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { useEmberField } from '../composables/useEmberField'
import {
  TrendingUp,
  Search,
  ScrollText,
  LibraryBig,
  Settings,
  Sparkles,
  Columns2,
  Circle,
  ArrowRight,
  Swords,
  ShieldCheck,
  Diamond
} from 'lucide-vue-next'
import { useGameState } from '../composables/useGameState'
import { launchLeagueByIpc } from '../services/ipc'
import { isWindows } from '../services/platform'
import { addHabitGoal, DIMENSION_LABELS, getHabitTags, type HabitTag } from '../services/insight'

const router = useRouter()
const message = useMessage()
const { isConnected: connected, summoner, reasonCode, reasonMessage, currentPhase } = useGameState()

/* ---------- 沉浸层 ---------- */
const reducedMotion = ref(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
)
const emberCanvas = ref<HTMLCanvasElement | null>(null)
useEmberField(emberCanvas, { cold: computed(() => !connected.value) })

const titleText = computed(() =>
  connected.value && summoner.value
    ? `${summoner.value.gameName}#${summoner.value.tagLine}`
    : 'RANK ANALYSIS'
)
const titleChars = computed(() => Array.from(titleText.value).map(char => ({ char })))

const tickerItems = computed(() => [
  { icon: Swords, text: connected.value ? phaseText.value : offTitle.value },
  { icon: Search, text: 'Ctrl K 唤起命令面板' },
  { icon: Columns2, text: '战绩详情并排对比 · Ctrl+Tab 切换窗口' },
  { icon: ShieldCheck, text: '数据仅存本地 · 云同步可选' }
])

/** 磁吸微倾斜（仅鼠标、非减弱动效） */
function tilt(e: PointerEvent) {
  if (reducedMotion.value || e.pointerType !== 'mouse') return
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width - 0.5
  const py = (e.clientY - r.top) / r.height - 0.5
  el.style.transform = `perspective(600px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg)`
}
function untilt(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).style.transform = ''
}

/* ---------- 问候 ---------- */
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const phaseText = computed(() => {
  switch (currentPhase.value) {
    case 'ChampSelect':
      return '英雄选择中 · 已自动切到对局页分析'
    case 'InProgress':
      return '对局进行中'
    case 'PreEndOfGame':
    case 'EndOfGame':
      return '对局结算'
    default:
      return '客户端在线，等待加入游戏'
  }
})

/* ---------- 未连接态：沿用原 Loading 的启动/提权能力 ---------- */
const canLaunch = computed(() => isWindows())
const canRelaunch = computed(() => isWindows())
const isAccessDenied = computed(() => reasonCode.value === 'ACCESS_DENIED')
const launching = ref(false)
const relaunching = ref(false)

const offTitle = computed(() =>
  !isAccessDenied.value
    ? '未连接客户端'
    : canRelaunch.value
      ? '需要管理员权限'
      : '无法读取客户端信息'
)
const offHint = computed(() => {
  if (isAccessDenied.value) {
    return canRelaunch.value
      ? (reasonMessage.value ?? '请以管理员身份运行本工具')
      : '请确认本工具与游戏客户端以同一用户身份运行。'
  }
  return '连接后将自动同步段位与战绩；也可点击下方按钮直接拉起游戏。'
})

async function launchLeague() {
  if (launching.value) return
  launching.value = true
  try {
    await launchLeagueByIpc()
    // 拉起成功保持 loading 态，等 game_state_monitor 推送连接后由状态卡自然切换
    setTimeout(() => (launching.value = false), 30000)
  } catch (e) {
    message.error(typeof e === 'string' ? e : '启动失败，请重试或手动打开游戏')
    launching.value = false
  }
}

async function relaunchAsAdmin() {
  if (relaunching.value) return
  relaunching.value = true
  try {
    await invoke('relaunch_as_admin')
  } catch (e) {
    console.error('以管理员身份重启失败:', e)
    relaunching.value = false
  }
}

/* ---------- 短板提醒 ---------- */
interface HabitTagLike {
  dimension: string
  avgVsPeer: number
  streak: number
}
const tagsLoading = ref(true)
const topTags = ref<HabitTagLike[]>([])

onMounted(async () => {
  try {
    const tags: HabitTag[] = await getHabitTags()
    topTags.value = [...tags].sort((a, b) => a.avgVsPeer - b.avgVsPeer).slice(0, 3)
  } catch {
    topTags.value = []
  } finally {
    tagsLoading.value = false
  }
})

function dimLabel(d: string) {
  return DIMENSION_LABELS[d as keyof typeof DIMENSION_LABELS] ?? d
}
function fmtDelta(v: number) {
  return `${v > 0 ? '+' : ''}${Math.round(v)}%`
}
function barWidth(v: number) {
  return `${Math.min(100, Math.max(6, Math.abs(Math.round(v))))}%`
}
async function turnToGoal(t: HabitTagLike) {
  try {
    await addHabitGoal(t.dimension, `改善「${dimLabel(t.dimension)}」`)
    message.success('已加入成长页改错清单')
  } catch {
    message.error('添加失败，请到成长页手动创建')
  }
}

/* ---------- 导航 ---------- */
function go(name: string) {
  router.push({ name })
}
function goRecordSelf() {
  const s = summoner.value
  router.push({
    name: 'Record',
    query: s?.gameName ? { name: `${s.gameName}#${s.tagLine}` } : undefined
  })
}
const openPalette = () => window.dispatchEvent(new CustomEvent('ra:open-palette'))
</script>

<style scoped>
/* ===== 沉浸层 ===== */
.home {
  /* 标杆页允许内容横跨内容区全宽，功能舱仍限宽居中 */
}
.hero {
  position: relative;
  overflow: hidden;
  min-height: clamp(280px, 36vh, 400px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-bottom: 1px solid var(--border-subtle);
  background:
    radial-gradient(
      120% 90% at 78% 8%,
      color-mix(in srgb, var(--brand) 9%, transparent),
      transparent 58%
    ),
    var(--bg-sunken);
}
.hero--cold {
  background:
    radial-gradient(
      120% 90% at 78% 8%,
      color-mix(in srgb, var(--text-tertiary) 6%, transparent),
      transparent 58%
    ),
    var(--bg-sunken);
}
.hero__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.hero__veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent 55%, var(--bg-base));
}
.hero__veil::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--noise-img);
  opacity: 0.05;
}
.hero__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 48px var(--space-24) 40px;
}
.hero__kicker {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  font-family: var(--font-num);
  font-size: var(--font-size-xs);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--brand);
}
.hero__rule {
  width: 30px;
  height: 1px;
  background: var(--brand-gradient);
  box-shadow: var(--glow-brand);
}
.hero__title {
  margin: var(--space-10) 0 var(--space-12);
  font-family: var(--font-num);
  font-size: clamp(34px, 6vw, 68px);
  font-weight: var(--font-weight-black);
  letter-spacing: var(--tracking-tight);
  line-height: 1.04;
  color: var(--text-primary);
  text-wrap: balance;
}
.hero__ch {
  display: inline-block;
  animation: home-ch-in 0.7s var(--ease-expo) both;
  animation-delay: calc(var(--d, 0) * 1ms);
}
.hero__ch--tag {
  color: var(--brand);
  text-shadow: var(--glow-brand);
}
.hero__meta {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
.hero__meta-sep {
  color: var(--text-tertiary);
}
.hero__meta-sub {
  color: var(--text-tertiary);
}
.pulse-dot {
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  background: var(--text-tertiary);
  flex: none;
}
.pulse-dot--on {
  background: var(--win);
  animation: home-pulse 2.2s ease-in-out infinite;
}

/* ticker */
.ticker {
  position: relative;
  z-index: 1;
  border-top: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-base) 62%, transparent);
  overflow: hidden;
  white-space: nowrap;
  mask-image: linear-gradient(to right, transparent, #000 6%, #000 94%, transparent);
}
.ticker__track {
  display: inline-flex;
  animation: home-ticker 30s linear infinite;
}
.ticker:hover .ticker__track {
  animation-play-state: paused;
}
.ticker__copy {
  display: inline-flex;
}
.ticker__item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px 9px 20px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.ticker__icon {
  width: 11px;
  height: 11px;
  color: var(--brand);
  opacity: 0.75;
}
.ticker__sep {
  width: 5px;
  height: 5px;
  margin-left: 22px;
  opacity: 0.3;
}

/* ===== 功能舱 ===== */
.home__inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-20) var(--space-24) 32px;
}
.home__grid {
  display: grid;
  gap: var(--space-16);
  margin-bottom: var(--space-16);
}
.home__grid--main {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}
.home__grid--sub {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.st-row {
  display: flex;
  align-items: center;
  gap: var(--space-10);
}
.st-row .btn {
  margin-left: auto;
}
.ic {
  width: 28px;
  height: 28px;
  flex: none;
  display: grid;
  place-items: center;
  background: var(--bg-active);
  clip-path: var(--clip-corner-sm);
  color: var(--text-secondary);
  transition:
    transform var(--dur-fast) var(--ease-spring),
    color var(--dur-fast) var(--ease-expo),
    background var(--dur-fast) var(--ease-expo);
}
.ic svg {
  width: 14px;
  height: 14px;
}
.ic-fill {
  fill: currentColor;
}
.btn-arrow-glyph {
  width: 11px;
  height: 11px;
  margin-left: 4px;
}
.ic--win {
  background: var(--win-soft);
  color: var(--win);
}
.st-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.st-copy b {
  font-size: var(--font-size-sm);
}

.tagp {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-size-2xs);
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-subtle);
}
.tagp.win {
  background: var(--win-soft);
  border-color: var(--win-border);
  color: var(--win);
}
.dot {
  width: 7px;
  height: 7px;
  transform: rotate(45deg);
  display: inline-block;
}
.dot--win {
  background: var(--win);
  box-shadow: var(--glow-win);
}

.psub {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
.kbd {
  font-family: var(--font-num);
  font-size: var(--font-size-2xs);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  padding: 0 6px;
  background: var(--bg-raised);
  color: var(--text-secondary);
}

.home__offline {
  text-align: center;
  padding: var(--space-8) 0;
}
.home__off-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  margin-bottom: var(--space-4);
}
.home__off-acts {
  display: flex;
  gap: var(--space-8);
  justify-content: center;
  margin-top: var(--space-12);
}

.short-list {
  display: flex;
  flex-direction: column;
}
.short-row {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.short-row:last-child {
  border-bottom: none;
}
.short-bar {
  flex: 1;
  height: 3px;
  min-width: 40px;
  background: var(--bg-active);
  clip-path: var(--clip-notch);
  overflow: hidden;
}
.short-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--loss-border), var(--loss));
}
.short-streak {
  margin-left: auto;
  flex: none;
}
.short-fix {
  flex: none;
}

.qentry {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-10);
  padding: 11px 2px;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
  color: var(--text-secondary);
  transition:
    transform var(--dur-fast) ease-out,
    color var(--dur-fast) var(--ease-expo);
}
button.qentry {
  font-family: inherit;
}
.qentry:last-child {
  border-bottom: none;
}
.qentry:hover {
  color: var(--brand);
}
.qentry:hover .ic {
  transform: translateY(-2px);
  color: var(--brand);
  background: var(--brand-soft);
}
.qentry--static,
.qentry--static:hover {
  cursor: default;
  color: var(--text-secondary);
}
.qentry--static:hover .ic {
  transform: none;
  background: var(--bg-active);
  color: var(--text-secondary);
}
.q-kbd {
  margin-left: auto;
}

/* 入场动效 */
.reveal {
  animation: home-rise 0.7s var(--ease-expo) both;
  animation-delay: calc(var(--d, 0) * 1ms);
}

@keyframes home-ch-in {
  from {
    opacity: 0;
    transform: translateY(0.45em);
    filter: blur(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}
@keyframes home-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes home-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--win-border);
  }
  50% {
    box-shadow: 0 0 0 6px transparent;
  }
}
@keyframes home-ticker {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal,
  .hero__ch {
    animation: none;
    opacity: 1;
    transform: none;
    filter: none;
  }
  .ticker__track,
  .pulse-dot--on {
    animation: none;
  }
}

@media (max-width: 900px) {
  .home__grid--main,
  .home__grid--sub {
    grid-template-columns: 1fr;
  }
  .short-streak {
    display: none;
  }
}
</style>
