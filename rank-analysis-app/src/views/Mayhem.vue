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

        <template v-else>
          <div class="m-roles">
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
          <label class="m-toggle">
            <input v-model="showNoSample" type="checkbox" /> 显示无胜率样本
          </label>
        </template>
      </div>

      <!-- Tab 1 英雄榜 -->
      <template v-if="activeTab === 'champions'">
        <div v-if="loading && !champions.length" class="m-empty">正在加载数据…</div>
        <div v-else-if="!filteredChampions.length" class="m-empty">没有符合条件的英雄</div>
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
        <div v-else-if="!filteredAugments.length" class="m-empty">没有符合条件的强化</div>
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
          <div v-if="!myChamps.length" class="m-empty">
            暂无自采数据——打完一局海克斯大乱斗后点上方按钮导入
          </div>
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
          <div v-if="!myAugs.length" class="m-empty">暂无强化数据</div>
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
 * Mayhem —— 海克斯大乱斗数据中心（feature-expansion-plan M1 / A1）
 * 双 Tab：英雄榜（官方 T 级 + 胜率）/ 强化榜（稀有度分组 + 轮次最佳标注）。
 * 首屏本地优先；无本地数据或手动点击才走网络同步。英雄卡跳详情子页。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import PageStage from '../components/ui/PageStage.vue'
import { Download, RefreshCw } from 'lucide-vue-next'
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

const CHANGES_SEEN_KEY = 'mayhem-changes-seen-version'

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

function switchTab(key: 'champions' | 'augments' | 'mine') {
  activeTab.value = key
  if (key === 'augments' && !augments.value.length && status.value?.ready) void loadAugments()
  // 「我的」需要强化名称表做展示；首次进入时并行拉取本地聚合
  if (key === 'mine') {
    if (!augments.value.length && status.value?.ready && !augsLoading.value) void loadAugments()
    if (!mineLoadedOnce.value) void loadMine()
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

/** 英雄名映射：优先用已加载的英雄榜，未命中回退 id 占位 */
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

function openChampion(id: number) {
  void router.push({ name: 'MayhemChampionDetail', params: { id: String(id) } })
}

function tierOf(c: MayhemChampion): number {
  return clampTier(c.stats.tier)
}

function tierOfAug(a: MayhemAugment): number | null {
  return a.stats?.tier == null ? null : clampTier(a.stats.tier)
}

function stageOfAug(a: MayhemAugment): number | null {
  return bestStage(a.stages ?? [])
}

function clampTier(v: number | null): number {
  return Math.min(Math.max(v ?? 5, 1), 5)
}

function pct(v: number | null | undefined): string {
  return v == null ? '--' : `${(v * 100).toFixed(v >= 0.1 ? 1 : 2)}%`
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

onMounted(async () => {
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
