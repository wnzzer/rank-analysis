<template>
  <div class="home">
    <PageHeader :kicker="`Home · ${greeting}，召唤师`">
      <template #title>
        <template v-if="connected && summoner"
          >{{ summoner.gameName }}<span class="home__tag">#{{ summoner.tagLine }}</span></template
        >
        <template v-else>RANK ANALYSIS</template>
      </template>
      <template #meta>
        <template v-if="connected">已连接 · 客户端运行中</template>
        <template v-else>未连接客户端</template>
      </template>
    </PageHeader>

    <div class="home__grid home__grid--main">
      <!-- 客户端状态卡：原 /Loading 页的职责并入此处（v2 壳层） -->
      <CornerCard title="客户端状态" :emphasis="!connected" class="home__status">
        <template #extra
          ><span v-if="connected" class="tagp win"><i class="dot dot--win"></i>在线</span></template
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
            <button v-if="canLaunch" class="btn pri sm" :disabled="launching" @click="launchLeague">
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
      <CornerCard title="短板提醒" subtitle="近 20 场聚合" emphasis class="home__shorts">
        <template #extra
          ><button class="btn gho sm" @click="go('Growth')">去成长 →</button></template
        >
        <div v-if="topTags.length" class="short-list">
          <div v-for="t in topTags" :key="t.dimension" class="short-row">
            <span class="tagp loss">{{ dimLabel(t.dimension) }} {{ fmtDelta(t.avgVsPeer) }}</span>
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
      <CornerCard title="快捷入口">
        <div class="qentry" @click="openPalette">
          <span class="ic"><Search /></span>查询玩家战绩<span class="kbd q-kbd">Ctrl K</span>
        </div>
        <div class="qentry" @click="goRecordSelf">
          <span class="ic"><ScrollText /></span>查看我的战绩
        </div>
        <div class="qentry" @click="go('Library')">
          <span class="ic"><LibraryBig /></span>资产库 · 标签与标记
        </div>
        <div class="qentry" @click="go('Settings')">
          <span class="ic"><Settings /></span>设置
        </div>
      </CornerCard>

      <CornerCard title="最近动态">
        <div class="qentry" style="cursor: default">
          <span class="ic"><Sparkles /></span>
          <span class="psub">选人期推荐 / 对局信号会在进入英雄选择后自动出现在「对局」页</span>
        </div>
        <div class="qentry" style="cursor: default">
          <span class="ic"><Columns2 /></span>
          <span class="psub">战绩子窗口支持并排对比：在战绩页打开详情后按 Ctrl+Tab 切换窗口</span>
        </div>
      </CornerCard>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Home —— 主页仪表盘（设计系统 v3 §C1，P1 新增默认落地页）
 *
 * 职责：
 * - 原 /Loading 的连接门职责并入「客户端状态卡」（含一键启动 / 管理员重启）；
 * - 成长短板 Top3 直达转化（转目标）；
 * - 快捷入口统一走 CommandPalette / 路由，不重复业务逻辑。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'

import PageHeader from '../components/ui/PageHeader.vue'
import CornerCard from '../components/ui/CornerCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import {
  TrendingUp,
  Search,
  ScrollText,
  LibraryBig,
  Settings,
  Sparkles,
  Columns2,
  Circle,
  ArrowRight
} from 'lucide-vue-next'
import { useGameState } from '../composables/useGameState'
import { launchLeagueByIpc } from '../services/ipc'
import { isWindows } from '../services/platform'
import { addHabitGoal, DIMENSION_LABELS, getHabitTags, type HabitTag } from '../services/insight'

const router = useRouter()
const message = useMessage()
const { isConnected: connected, summoner, reasonCode, reasonMessage, currentPhase } = useGameState()

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
.home {
  max-width: 1080px;
  margin: 0 auto;
}
.home__tag {
  color: var(--text-tertiary);
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-lg);
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
.short-streak {
  margin-left: auto;
}
.short-fix {
  flex: none;
}

.qentry {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--font-size-sm);
  cursor: pointer;
  color: var(--text-secondary);
}
.qentry:last-child {
  border-bottom: none;
}
.qentry:hover {
  color: var(--brand);
}
.q-kbd {
  margin-left: auto;
}

@media (max-width: 900px) {
  .home__grid--main,
  .home__grid--sub {
    grid-template-columns: 1fr;
  }
}
</style>
