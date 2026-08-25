<template>
  <div class="home">
    <!-- ===== S1 · 沉浸舞台 ===== -->
    <section ref="stageEl" class="stage">
      <canvas ref="emberCanvas" class="stage__ember" aria-hidden="true"></canvas>
      <div class="stage__shards" aria-hidden="true">
        <svg
          v-for="(s, i) in shards"
          :key="i"
          class="shard"
          :style="{
            left: s.x,
            top: s.y,
            width: s.size,
            '--p': s.depth,
            '--float-d': s.floatDur + 's',
            animationDelay: s.delay
          }"
          viewBox="0 0 100 100"
          fill="none"
        >
          <polygon
            points="50,3 93,26 93,74 50,97 7,74 7,26"
            stroke="currentColor"
            stroke-width="2"
          />
        </svg>
      </div>
      <div class="stage__veil" aria-hidden="true"></div>

      <div class="stage__content">
        <p class="stage__kicker reveal" style="--d: 0">
          <span class="kicker-dot" aria-hidden="true"></span>
          {{ greeting }}，召唤师 —— FORGE CONSOLE
        </p>

        <h1 class="stage__title" :aria-label="titleText">
          <span class="stage__line reveal" style="--d: 60ms">{{
            connected && summoner ? summoner.gameName : 'FORGE'
          }}</span>
          <span class="stage__line stage__line--ghost reveal" style="--d: 160ms">
            <template v-if="connected && summoner">#{{ summoner.tagLine }}</template>
            <template v-else>YOUR RANK</template>
          </span>
        </h1>

        <div class="stage__meta reveal" style="--d: 280ms">
          <span class="pulse-dot" :class="{ 'pulse-dot--on': connected }"></span>
          <span>{{ connected ? phaseText : offTitle }}</span>
          <span class="meta-sep" aria-hidden="true">/</span>
          <span class="meta-sub">{{
            connected ? '客户端运行中' : '启动后自动同步段位与战绩'
          }}</span>
        </div>
      </div>

      <div class="scroll-cue reveal" style="--d: 600ms" aria-hidden="true">
        <ChevronDown class="cue-icon" />
        <span class="cue-text">SCROLL</span>
      </div>
    </section>

    <!-- ===== S2 · 描边巨幕走马灯 ===== -->
    <div class="gmarquee" aria-hidden="true">
      <div class="gmarquee__track">
        <span v-for="copy in 2" :key="copy" class="gmarquee__copy">
          <span
            v-for="word in ['FORGE YOUR RANK', 'RANK ANALYSIS', 'RISE ABOVE']"
            :key="word"
            class="gmarquee__word"
          >
            {{ word }}<Diamond class="gmarquee__sep"
          /></span>
        </span>
      </div>
    </div>

    <!-- ===== S3 · 功能舱 ===== -->
    <div class="home__inner">
      <div class="home__grid home__grid--main">
        <CornerCard title="客户端状态" :emphasis="!connected" class="reveal" style="--d: 80ms">
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

        <CornerCard
          title="短板提醒"
          subtitle="近 20 场聚合"
          emphasis
          class="reveal"
          style="--d: 160ms"
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
        <CornerCard title="快捷入口" class="reveal" style="--d: 240ms">
          <div v-for="(e, i) in orderedQuickEntries" :key="e.id" class="qentry-wrap">
            <button class="qentry" @click="e.run">
              <span class="qentry__idx num">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="ic"><component :is="e.icon" /></span>
              <span class="qentry__label">{{ e.label }}</span>
              <span v-if="e.kbd" class="kbd q-kbd">{{ e.kbd }}</span>
            </button>
            <span class="qentry-sort" aria-hidden="true">
              <button
                class="sort-btn"
                :disabled="i === 0"
                aria-label="上移"
                @click.stop="moveQuickEntry(i, -1)"
              >
                <ChevronUp />
              </button>
              <button
                class="sort-btn"
                :disabled="i === orderedQuickEntries.length - 1"
                aria-label="下移"
                @click.stop="moveQuickEntry(i, 1)"
              >
                <ChevronDown />
              </button>
            </span>
          </div>
        </CornerCard>

        <CornerCard title="最近动态" class="reveal" style="--d: 320ms">
          <div class="qentry qentry--static">
            <span class="qentry__idx num">··</span>
            <span class="ic"><Sparkles /></span>
            <span class="psub">选人期推荐 / 对局信号会在进入英雄选择后自动出现在「对局」页</span>
          </div>
          <div class="qentry qentry--static">
            <span class="qentry__idx num">··</span>
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
 * Home —— 主页 · 旗舰沉浸页（ui-ux-pro-max 设计系统落地）
 *
 * 检索结论：Immersive/Interactive 模式 + Dark OLED 底 + Kinetic Motion 字组
 * （Syncopate 显示体 / Space Mono 数据体）+ 多层视差（3 层）+ 物理光效；
 * 红线：prefers-reduced-motion 全降级、transform/opacity 动画、对比度达标。
 *
 * 功能契约不变：连接门（启动/管理员重启）、短板转目标、命令面板入口。
 */
import { computed, markRaw, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
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
  ChevronDown,
  ChevronUp,
  Diamond
} from 'lucide-vue-next'
import { useGameState } from '../composables/useGameState'
import { launchLeagueByIpc } from '../services/ipc'
import { isWindows } from '../services/platform'
import { addHabitGoal, DIMENSION_LABELS, getHabitTags, type HabitTag } from '../services/insight'

const router = useRouter()
const message = useMessage()
const { isConnected: connected, summoner, reasonCode, reasonMessage, currentPhase } = useGameState()

/* ---------- 沉浸层：余烬场 + 视差 ---------- */
const reducedMotion = ref(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
)
const emberCanvas = ref<HTMLCanvasElement | null>(null)
useEmberField(emberCanvas, { cold: computed(() => !connected.value) })

/** 六边形碎片层：视差系数 --p 越大位移越强 */
const shards = [
  { x: '8%', y: '18%', size: '92px', depth: 1.4, floatDur: 9, delay: '0s' },
  { x: '78%', y: '12%', size: '56px', depth: 2.2, floatDur: 7, delay: '-2s' },
  { x: '88%', y: '58%', size: '128px', depth: 0.9, floatDur: 11, delay: '-4s' },
  { x: '16%', y: '66%', size: '44px', depth: 2.6, floatDur: 8, delay: '-1s' },
  { x: '58%', y: '76%', size: '70px', depth: 1.8, floatDur: 10, delay: '-5s' }
]

const stageEl = ref<HTMLElement | null>(null)

/* ---------- 快捷入口：数据驱动 + 顺序持久化（localStorage） ---------- */
interface QuickEntryDef {
  id: string
  label: string
  icon: Component
  kbd?: string
  run: () => void
}
const QUICK_ORDER_KEY = 'home.quickOrder'
const quickDefs: Array<Omit<QuickEntryDef, 'run'>> = [
  { id: 'palette', label: '查询玩家战绩', icon: markRaw(Search), kbd: 'Ctrl K' },
  { id: 'record', label: '查看我的战绩', icon: markRaw(ScrollText) },
  { id: 'library', label: '资产库 · 标签与标记', icon: markRaw(LibraryBig) },
  { id: 'settings', label: '设置', icon: markRaw(Settings) }
]
const quickOrder = ref<string[]>(loadQuickOrder())
function loadQuickOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(QUICK_ORDER_KEY) ?? '[]') as string[]
    return Array.isArray(v) ? v.filter(x => quickDefs.some(d => d.id === x)) : []
  } catch {
    return []
  }
}
const orderedQuickEntries = computed<QuickEntryDef[]>(() => {
  const runners: Record<string, () => void> = {
    palette: openPalette,
    record: goRecordSelf,
    library: () => go('Library'),
    settings: () => go('Settings')
  }
  const map = new Map(quickDefs.map(d => [d.id, { ...d, run: runners[d.id] }]))
  const out: QuickEntryDef[] = []
  for (const id of quickOrder.value) {
    const d = map.get(id)
    if (d) {
      out.push(d)
      map.delete(id)
    }
  }
  out.push(...map.values())
  return out
})
function moveQuickEntry(i: number, dir: -1 | 1): void {
  const ids = orderedQuickEntries.value.map(e => e.id)
  const j = i + dir
  if (j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  quickOrder.value = ids
  try {
    localStorage.setItem(QUICK_ORDER_KEY, JSON.stringify(ids))
  } catch {
    /* 隐私模式写失败静默 */
  }
}
let parallaxRaf = 0
let pmx = 0
let pmy = 0

function applyParallax() {
  parallaxRaf = 0
  const el = stageEl.value
  if (!el) return
  el.style.setProperty('--mx', pmx.toFixed(3))
  el.style.setProperty('--my', pmy.toFixed(3))
}
function onStagePointer(e: PointerEvent) {
  if (reducedMotion.value || e.pointerType !== 'mouse') return
  const r = stageEl.value?.getBoundingClientRect()
  if (!r) return
  pmx = (e.clientX - r.left) / r.width - 0.5
  pmy = (e.clientY - r.top) / r.height - 0.5
  if (!parallaxRaf) parallaxRaf = requestAnimationFrame(applyParallax)
}

const titleText = computed(() =>
  connected.value && summoner.value
    ? `${summoner.value.gameName}#${summoner.value.tagLine}`
    : 'FORGE YOUR RANK'
)

/* ---------- 问候 / 阶段 ---------- */
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
  window.addEventListener('pointermove', onStagePointer, { passive: true })
  try {
    const tags: HabitTag[] = await getHabitTags()
    topTags.value = [...tags].sort((a, b) => a.avgVsPeer - b.avgVsPeer).slice(0, 3)
  } catch {
    topTags.value = []
  } finally {
    tagsLoading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onStagePointer)
  if (parallaxRaf) cancelAnimationFrame(parallaxRaf)
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

<style scoped src="./Home.styles.css"></style>
