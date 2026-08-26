<template>
  <div class="mayhem">
    <PageStage
      kicker="MAYHEM · 海克斯大乱斗"
      title="大 乱 斗"
      sub="英雄强度 · 强化排行 · 版本数据"
      compact
    >
      <template #actions>
        <span v-if="status?.activeVersion" class="mver">
          数据 {{ status.activeVersion }}
          <template v-if="syncedDateText"> · {{ syncedDateText }}</template>
        </span>
        <button class="btn gho sm" :disabled="syncing" @click="onSync(true)">
          <RefreshCw class="btn-ico" :class="{ spinning: syncing }" />
          {{ syncing ? '同步中…' : '刷新数据' }}
        </button>
      </template>
    </PageStage>

    <div class="m-body">
      <div v-if="changeBanner" class="m-changes">
        <span>
          版本 {{ changeBanner.toVersion }} 变动：新增强化 {{ changeBanner.added.length }} · 移除
          {{ changeBanner.removed.length }} · T 级跃迁 {{ changeBanner.tierMoves.length }} ·
          胜率显著漂移 {{ changeBanner.wrDrifts.length }}
        </span>
        <button class="chip" @click="dismissChanges">知道了</button>
      </div>

      <div v-if="error" class="m-alert">{{ error }}</div>

      <div class="m-tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="mtab"
          :class="{ on: activeTab === t.key }"
          @click="switchTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="m-toolbar">
        <input v-model.trim="search" class="m-search" type="search" placeholder="搜索…" />

        <div v-if="activeTab === 'champions'" class="m-roles">
          <button
            v-for="r in roleOptions"
            :key="r.key"
            class="chip"
            :class="{ 'chip--on': activeRole === r.key }"
            @click="activeRole = r.key"
          >
            {{ r.label }}
          </button>
        </div>

        <div v-else-if="activeTab === 'augments'" class="m-roles">
          <button
            v-for="r in RARITY_OPTIONS"
            :key="r.key"
            class="chip"
            :class="{ 'chip--on': activeRarity === r.key }"
            @click="activeRarity = r.key"
          >
            {{ r.label }}
          </button>
        </div>

        <!-- 强化榜工具行：低样本开关 / 浮窗预览 / 对局监听 / 手动入口 -->
        <template v-if="activeTab === 'augments'">
          <label class="m-toggle">
            <input v-model="showNoSample" type="checkbox" /> 显示无胜率样本
          </label>
          <button class="btn gho sm" :disabled="previewing" @click="onPreviewPanel">
            {{ previewing ? '推送中…' : '预览浮窗' }}
          </button>
          <button class="btn gho sm" :class="{ 'btn--on': assistRunning }" @click="toggleAssist">
            {{ assistRunning ? '停止对局监听' : '启动对局监听' }}
          </button>
          <button class="btn gho sm" @click="manualOpen = !manualOpen">手动三选一</button>
          <button class="btn gho sm" :disabled="calibrating" @click="onCalibrate">
            {{ calibrating ? '截取中…' : '校准截图' }}
          </button>
          <span v-if="lastTick" class="m-toggle">
            {{ lastTick.note
            }}<template v-if="lastTick.maxStddev != null">
              · 峰值 {{ lastTick.maxStddev.toFixed(1) }}</template
            >
          </span>
        </template>
      </div>

      <!-- 校准视图：三张标题带的实际截取内容，用于对准 capture.rs 标定常数 -->
      <div v-if="bandDump.length" class="m-calib">
        <img
          v-for="d in bandDump"
          :key="d.slot"
          class="m-calib__shot"
          :src="`data:image/bmp;base64,${d.bmpBase64}`"
          :alt="`卡位 ${d.slot}`"
          :title="`卡位 ${d.slot}（左/中/右）实际截取区域`"
        />
        <span class="m-toggle">
          若框未对准卡名，请调整 src-tauri/src/mayhem/capture.rs 的标定常数后重新截取。
        </span>
      </div>

      <!-- 手动三选一（OCR 兜底）：输入卡面文字 → 打分 → 推浮窗 -->
      <div v-if="manualOpen" class="m-manual">
        <input
          v-for="(_, i) in manualTexts"
          :key="i"
          v-model.trim="manualTexts[i]"
          class="m-search m-manual__slot"
          :placeholder="['左卡名称', '中卡名称', '右卡名称'][i]"
          maxlength="20"
          @keydown.enter="onManualAssist"
        />
        <label class="m-toggle"
          >重随
          <input v-model.number="manualRerolls" type="number" min="0" max="9" style="width: 48px" />
        </label>
        <button class="btn pri sm" :disabled="manualBusy" @click="onManualAssist">
          {{ manualBusy ? '推送中…' : '打分并推浮窗' }}
        </button>
      </div>

      <!-- Tab 1 英雄榜 -->
      <template v-if="activeTab === 'champions'">
        <div v-if="loading && !champions.length" class="m-empty">正在加载数据…</div>
        <EmptyState
          v-else-if="!filteredChampions.length"
          :icon="SearchX"
          title="没有符合条件的英雄"
          description="尝试更换搜索关键词或职业分类"
        >
          <template #action>
            <button class="btn gho sm" @click="onResetChampFilter">清空筛选</button>
          </template>
        </EmptyState>
        <div v-else class="m-grid">
          <button
            v-for="c in filteredChampions"
            :key="c.id"
            class="ccard"
            :title="`${c.name}·${c.title}`"
            @click="openChampion(c.id)"
          >
            <span class="ctier" :class="`t${tierOf(c)}`">T{{ tierOf(c) }}</span>
            <img class="cico" :src="c.iconUrl" :alt="c.title" loading="lazy" />
            <span class="cname">{{ c.title }}</span>
            <span class="calias">{{ c.name }}</span>
            <span class="cwr">{{ pct(c.stats.winRate) }}</span>
            <span class="cpr">选取 {{ pct(c.stats.pickRate) }}</span>
            <span class="croles">
              <i v-for="role in c.roles.slice(0, 2)" :key="role">{{ roleLabel(role) }}</i>
            </span>
          </button>
        </div>
      </template>

      <!-- Tab 2 强化榜 -->
      <template v-else-if="activeTab === 'augments'">
        <div v-if="augsLoading && !augments.length" class="m-empty">正在加载数据…</div>
        <EmptyState
          v-else-if="!filteredAugments.length"
          :icon="SearchX"
          title="没有符合条件的强化"
          description="尝试更换搜索关键词或稀有度筛选"
        >
          <template #action>
            <button class="btn gho sm" @click="onResetAugFilter">清空筛选</button>
          </template>
        </EmptyState>
        <div v-else class="m-grid m-grid--aug">
          <div v-for="a in filteredAugments" :key="a.id" class="acard" :title="plainDesc(a)">
            <span v-if="tierOfAug(a)" class="ctier" :class="`t${tierOfAug(a)}`"
              >T{{ tierOfAug(a) }}</span
            >
            <img
              class="aico"
              :src="perkSrc(a.id)"
              :alt="a.name"
              loading="lazy"
              @error="fallbackIcon($event, a.iconUrl)"
            />
            <span class="aname">{{ a.name }}</span>
            <span class="ararity" :class="`rr-${a.rarityName}`">{{ a.rarityDisplayName }}</span>
            <span class="awr">{{ pct(a.stats?.winRate) }}</span>
            <span class="apr">
              选取 {{ pct(a.stats?.pickRate) }}
              <em v-if="stageOfAug(a)">· 第{{ stageOfAug(a) }}轮最佳</em>
            </span>
            <span v-if="a.topChampions?.length" class="atops">
              <img
                v-for="tc in a.topChampions.slice(0, 5)"
                :key="tc.id"
                :src="tc.iconUrl"
                :alt="tc.title"
                :title="`${tc.name}·${tc.title}`"
                loading="lazy"
              />
            </span>
          </div>
        </div>
      </template>

      <!-- Tab 3 我的数据 -->
      <template v-else>
        <div class="mine-head">
          <button class="btn pri sm" :disabled="importing" @click="onImport">
            <Download class="btn-ico" :class="{ spinning: importing }" />
            {{ importing ? '导入中…' : '导入最近战绩' }}
          </button>
          <span v-if="importNote" class="mine-note">{{ importNote }}</span>
        </div>

        <section class="d-sec">
          <h3>我的英雄</h3>
          <EmptyState
            v-if="!myChamps.length"
            :icon="Inbox"
            title="暂无自采英雄数据"
            description="打完一局海克斯大乱斗后点上方「导入最近战绩」即可汇总个人绝活"
          />
          <div v-else class="mylist">
            <div
              v-for="c in myChamps"
              :key="c.championId"
              class="myrow"
              @click="openChampion(c.championId)"
            >
              <img
                class="myrow__ico"
                :src="`${assetPrefix}/champion/${c.championId}`"
                alt=""
                loading="lazy"
              />
              <span class="myrow__name">{{ champName(c.championId) }}</span>
              <span class="myrow__g">{{ c.games }} 场</span>
              <span class="mybar"><i :style="{ width: wrPct(c) }" /></span>
              <span class="myrow__wr">{{ pct(c.wins / Math.max(c.games, 1)) }}</span>
              <span class="myrow__kda">KDA {{ kda(c.kills, c.deaths, c.assists) }}</span>
            </div>
          </div>
        </section>

        <section class="d-sec">
          <h3>我的强化</h3>
          <EmptyState
            v-if="!myAugs.length"
            :icon="Inbox"
            title="暂无自采强化数据"
            description="打完一局海克斯大乱斗后点上方「导入最近战绩」即可汇总强化表现"
          />
          <div v-else class="mylist mylist--aug">
            <div
              v-for="a in myAugs.slice(0, 20)"
              :key="a.augmentId"
              class="myrow"
              :title="augTooltipOf(a.augmentId)"
            >
              <img
                class="myrow__ico sq"
                :src="perkSrc(a.augmentId)"
                alt=""
                loading="lazy"
                @error="fallbackIcon($event, augRemoteIcon(a.augmentId))"
              />
              <span class="myrow__name">{{ augNameOf(a.augmentId) }}</span>
              <span class="myrow__g">{{ a.games }} 场</span>
              <span class="mybar"><i :style="{ width: augWrPct(a) }" /></span>
              <span class="myrow__wr">{{ pct(a.wins / Math.max(a.games, 1)) }}</span>
              <span class="myrow__kda"></span>
            </div>
          </div>
        </section>
      </template>

      <p class="m-note">
        数据来源：aramgg 公开客户端 API（腾讯国服公开统计口径，T 级官方、胜率随版本每日更新）。
        数据缓存于本地，离线时展示上一同步版本。点击英雄卡可进入大乱斗详情。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Mayhem —— 海克斯大乱斗数据中心（feature-expansion-plan M1 / A1 / A3）
 * 三 Tab：英雄榜 / 强化榜 / 我的；强化榜含浮窗预览、对局监听与手动三选一兜底。
 * 首屏本地优先；无本地数据或手动点击才走网络同步。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'

import PageStage from '../components/ui/PageStage.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { Download, Inbox, RefreshCw, SearchX } from 'lucide-vue-next'
import { assetPrefix } from '../services/http'
import {
  bestStage,
  getMayhemAugments,
  getMayhemChampions,
  getMayhemStatus,
  getMayhemVersionChanges,
  getMyAugmentStats,
  getMyChampionStats,
  importMayhemRecent,
  stripRichText,
  syncMayhemData,
  type MayhemAugment,
  type MayhemChampion,
  type MayhemStatus,
  type MayhemVersionChange,
  type MyAugmentStat,
  type MyChampionStat
} from '../features/mayhem/services/mayhemData'
import {
  assistManual,
  previewAugmentOverlay,
  pushOverlayPanel,
  setOverlayClickThrough,
  setOverlayLayout
} from '../features/overlay/panels'
import { applyOverlayHotkey } from '../features/overlay/hotkeys'
import {
  createAssistScheduler,
  type AssistScheduler,
  type AssistTick,
  type BandDumpDto,
  type BandStatsDto
} from '../features/mayhem/trigger'
import { loadOverlayPrefs } from '../utils/overlayPrefs'

const TABS = [
  { key: 'champions', label: '英雄榜' },
  { key: 'augments', label: '强化榜' },
  { key: 'mine', label: '我的' }
] as const

const ROLE_LABELS: Record<string, string> = {
  tank: '坦克',
  fighter: '战士',
  assassin: '刺客',
  mage: '法师',
  marksman: '射手',
  support: '辅助'
}

const RARITY_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'prismatic', label: '棱彩' },
  { key: 'gold', label: '黄金' },
  { key: 'silver', label: '白银' }
]

/** 对局监听调度器单例（跨 Tab 切换保持运行） */
let assist: AssistScheduler | null = null

const CHANGES_SEEN_KEY = 'mayhem-changes-seen-version'

const router = useRouter()

const status = ref<MayhemStatus | null>(null)
const champions = ref<MayhemChampion[]>([])
const augments = ref<MayhemAugment[]>([])
const loading = ref(false)
const augsLoading = ref(false)
const syncing = ref(false)
const error = ref('')
const search = ref('')
const activeTab = ref<'champions' | 'augments' | 'mine'>('champions')
const activeRole = ref('all')
const activeRarity = ref('all')
const showNoSample = ref(false)

const myChamps = ref<MyChampionStat[]>([])
const myAugs = ref<MyAugmentStat[]>([])
const importing = ref(false)
const importNote = ref('')
const mineLoadedOnce = ref(false)
const versionChanges = ref<MayhemVersionChange[]>([])
const previewing = ref(false)
const assistRunning = ref(false)
const lastTick = ref<AssistTick | null>(null)
const manualOpen = ref(false)
const manualTexts = ref<string[]>(['', '', ''])
const manualRerolls = ref<number>(2)
const manualBusy = ref(false)
const calibrating = ref(false)
const bandDump = ref<BandDumpDto[]>([])

const roleOptions = [
  { key: 'all', label: '全部' },
  ...Object.entries(ROLE_LABELS).map(([key, label]) => ({ key, label }))
]

const syncedDateText = computed(() => {
  if (!status.value?.syncedAt) return ''
  const d = new Date(status.value.syncedAt * 1000)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}-${d.getDate()} 同步`
})

const filteredChampions = computed(() => {
  const kw = search.value.toLowerCase()
  return [...champions.value]
    .filter(c => activeRole.value === 'all' || c.roles.includes(activeRole.value))
    .filter(
      c =>
        !kw ||
        c.title.toLowerCase().includes(kw) ||
        c.name.toLowerCase().includes(kw) ||
        c.alias.toLowerCase().includes(kw)
    )
    .sort((a, b) => (b.stats.winRate ?? 0) - (a.stats.winRate ?? 0))
})

const filteredAugments = computed(() => {
  const kw = search.value.toLowerCase()
  return [...augments.value]
    .filter(a => activeRarity.value === 'all' || a.rarityName === activeRarity.value)
    .filter(a => showNoSample.value || (a.stats?.winRate != null && a.statsAvailable))
    .filter(
      a =>
        !kw ||
        a.name.toLowerCase().includes(kw) ||
        a.key.toLowerCase().includes(kw) ||
        String(a.id).includes(kw)
    )
    .sort((a, b) => (b.stats?.winRate ?? -1) - (a.stats?.winRate ?? -1))
})

/** 仅展示「当前激活版本」对应的最新变动，且未被用户点过“知道了” */
const changeBanner = computed<MayhemVersionChange | null>(() => {
  const latest = versionChanges.value[0]
  if (!latest || !status.value?.activeVersion) return null
  if (latest.toVersion !== status.value.activeVersion) return null
  const empty =
    !latest.added.length &&
    !latest.removed.length &&
    !latest.tierMoves.length &&
    !latest.wrDrifts.length
  if (empty) return null
  try {
    if (localStorage.getItem(CHANGES_SEEN_KEY) === latest.toVersion) return null
  } catch {
    /* localStorage 不可用时不做持久化忽略 */
  }
  return latest
})

function dismissChanges() {
  const v = changeBanner.value?.toVersion
  if (!v) return
  try {
    localStorage.setItem(CHANGES_SEEN_KEY, v)
  } catch {
    /* ignore */
  }
  versionChanges.value = []
}

function switchTab(key: 'champions' | 'augments' | 'mine') {
  activeTab.value = key
  if (key === 'augments' && !augments.value.length && status.value?.ready) void loadAugments()
  // 「我的」需要强化名称表做展示；首次进入时并行拉取本地聚合
  if (key === 'mine') {
    if (!augments.value.length && status.value?.ready && !augsLoading.value) void loadAugments()
    if (!mineLoadedOnce.value) void loadMine()
  }
}

function onResetChampFilter() {
  search.value = ''
  activeRole.value = 'all'
}

function onResetAugFilter() {
  search.value = ''
  activeRarity.value = 'all'
}

function openChampion(id: number) {
  void router.push({ name: 'MayhemChampionDetail', params: { id: String(id) } })
}

function tierOf(c: MayhemChampion): number {
  return clampTier(c.stats.tier ?? 5)
}

function tierOfAug(a: MayhemAugment): number | null {
  return a.stats?.tier == null ? null : clampTier(a.stats.tier)
}

function stageOfAug(a: MayhemAugment): number | null {
  return bestStage(a.stages ?? [])
}

function clampTier(v: number): number {
  return Math.min(Math.max(v, 1), 5)
}

function pct(v: number | null | undefined): string {
  if (v == null) return '--'
  // 相对胜率（情境装等差值口径）带符号展示更准确
  const abs = Math.abs(v)
  const text = (abs * 100).toFixed(abs >= 0.1 ? 1 : 2)
  return v < 0 ? `-${text}%` : `${text}%`
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** 本地缓存优先的强化图标（LCU cherry-augments 走 perk 通道） */
function perkSrc(id: number): string {
  return `${assetPrefix}/perk/${id}`
}

function fallbackIcon(ev: Event, remoteUrl?: string) {
  const img = ev.target as HTMLImageElement | null
  if (!img || !remoteUrl || img.dataset.fallback === remoteUrl) return
  img.dataset.fallback = remoteUrl
  img.src = remoteUrl
}

function plainDesc(a: MayhemAugment): string {
  return stripRichText(a.description || a.tooltip)
}

async function loadData() {
  loading.value = true
  error.value = ''
  try {
    const res = await getMayhemChampions()
    champions.value = res.champions ?? []
  } catch (e) {
    error.value = `读取本地数据失败：${String(e)}（可尝试刷新数据）`
  } finally {
    loading.value = false
  }
}

async function loadAugments() {
  augsLoading.value = true
  try {
    const res = await getMayhemAugments()
    augments.value = res.data ?? []
  } catch (e) {
    error.value = `读取强化数据失败：${String(e)}`
  } finally {
    augsLoading.value = false
  }
}

async function onSync(force: boolean) {
  syncing.value = true
  try {
    await syncMayhemData(force)
    await Promise.all([loadData(), loadAugments()])
    status.value = await getMayhemStatus()
  } catch (e) {
    error.value = `同步失败（离线时可继续使用本地版本）：${String(e)}`
  } finally {
    syncing.value = false
  }
}

async function loadMine() {
  mineLoadedOnce.value = true
  try {
    ;[myChamps.value, myAugs.value] = await Promise.all([getMyChampionStats(), getMyAugmentStats()])
  } catch (e) {
    error.value = `读取自采数据失败：${String(e)}`
  }
}

async function onImport() {
  importing.value = true
  importNote.value = ''
  try {
    const r = await importMayhemRecent()
    importNote.value =
      `扫描 ${r.scanned} 场：新增 ${r.imported}，已有 ${r.skippedExisting}` +
      (r.failed ? `，失败 ${r.failed}` : '')
    await loadMine()
  } catch (e) {
    importNote.value = `导入失败（需客户端在线）：${String(e)}`
  } finally {
    importing.value = false
  }
}

function champName(id: number): string {
  const c = champions.value.find(x => x.id === id)
  return c ? `${c.title}（${c.name}）` : `英雄 #${id}`
}

function augNameOf(id: number): string {
  const a = augments.value.find(x => x.id === id)
  return a?.name ?? `强化 #${id}`
}

function augTooltipOf(id: number): string {
  const a = augments.value.find(x => x.id === id)
  return a ? plainDesc(a) || a.name : ''
}

function augRemoteIcon(id: number): string | undefined {
  return augments.value.find(x => x.id === id)?.iconUrl
}

function wrPct(c: MyChampionStat): string {
  return `${((c.wins / Math.max(c.games, 1)) * 100).toFixed(0)}%`
}

function augWrPct(a: MyAugmentStat): string {
  return `${((a.wins / Math.max(a.games, 1)) * 100).toFixed(0)}%`
}

function kda(kills: number, deaths: number, assists: number): string {
  return deaths === 0 ? '∞' : ((kills + assists) / deaths).toFixed(2)
}

async function onPreviewPanel() {
  previewing.value = true
  try {
    await previewAugmentOverlay()
  } catch (e) {
    error.value = `预览失败：${String(e)}（需先同步大乱斗数据）`
  } finally {
    previewing.value = false
  }
}

/** 校准截图：导出三张卡标题带的实际截取内容（BMP 预览） */
async function onCalibrate() {
  calibrating.value = true
  try {
    bandDump.value = (await invoke('mayhem_capture_band_dump')) as BandDumpDto[]
  } catch (e) {
    error.value = `校准截图失败：${String(e)}`
  } finally {
    calibrating.value = false
  }
}

async function onManualAssist() {
  const texts = manualTexts.value.filter(t => t.length > 0)
  if (!texts.length) {
    error.value = '请至少输入一张卡的名称'
    return
  }
  manualBusy.value = true
  try {
    await assistManual(texts, undefined, manualRerolls.value)
  } catch (e) {
    error.value = `手动三选一失败：${String(e)}（需先同步大乱斗数据）`
  } finally {
    manualBusy.value = false
  }
}

/** 对局监听：周期 tick 检测三选一画面；检测沿触发后端真管线并推送面板 */
function toggleAssist() {
  if (!assist) {
    assist = createAssistScheduler({
      getPhase: () => invoke('mayhem_gameflow_phase') as Promise<string>,
      getBandStats: () => invoke('mayhem_capture_band_stats') as Promise<BandStatsDto[]>,
      onTick: t => {
        lastTick.value = t
      },
      onDetected: async () => {
        const outcome = (await invoke('mayhem_assist_tick', { championId: null })) as {
          pushed?: boolean
          payload?: unknown
        }
        if (!outcome.pushed || !outcome.payload) return
        await setOverlayLayout(560, 240, 'top-center')
        await pushOverlayPanel('mayhem-augments', outcome.payload)
      }
    })
  }
  if (assist.running) {
    assist.stop()
    assistRunning.value = false
    return
  }
  // 对局中浮窗必须保持穿透，避免挡操作；手动校正面板出现时再关穿透
  void setOverlayClickThrough(true).catch(() => {})
  assist.start()
  assistRunning.value = true
}

onMounted(async () => {
  // 同步单例调度器现有状态（跨页切换保持状态一致）
  if (assist?.running) {
    assistRunning.value = true
    lastTick.value = assist.lastTick()
  }

  // 全局热键幂等应用（进入大乱斗页即确保 Alt+A 可用；失败仅告警）
  void applyOverlayHotkey(loadOverlayPrefs().hotkeyEnabled).catch(e =>
    console.warn('热键注册失败:', e)
  )
  try {
    status.value = await getMayhemStatus()
    void getMayhemVersionChanges()
      .then(list => {
        versionChanges.value = list
      })
      .catch(() => {})
    if (!status.value.ready) {
      await onSync(false)
    } else {
      await loadData()
    }
  } catch (e) {
    error.value = `初始化失败：${String(e)}`
    loading.value = false
  }
})
</script>

<style scoped src="./Mayhem.styles.css"></style>
