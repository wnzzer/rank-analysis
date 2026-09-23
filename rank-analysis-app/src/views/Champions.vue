<script setup lang="ts">
/**
 * 英雄榜：本版本（本段位、本分路）谁强
 *
 * 数据来自 OP.GG 列表快照（`list_champion_metas` 一次取齐约 400 行），筛选 / 搜索 /
 * 排序全在前端（见 `components/champions/championTier.ts`）——点列头即时重排。
 * 点某一行拉出抽屉看符文 / 出装 / 加点 / 被克制对位（`ChampionDetailDrawer`）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import {
  ensureOpggData,
  getOpggStatus,
  listChampionMetas,
  opggRevision,
  TIER_OPTIONS,
  type ChampionMeta,
  type OpggStatus,
  type OpggTier
} from '@renderer/services/opgg'
import { useOpggTier } from '@renderer/composables/useOpggTier'
import ChampionTierTable from '@renderer/components/champions/ChampionTierTable.vue'
import ChampionDetailPanel from '@renderer/components/champions/ChampionDetailPanel.vue'
import {
  filterRows,
  sortRows,
  toRows,
  type SortKey,
  type TierRow
} from '@renderer/components/champions/championTier'
import type { championOption } from '@renderer/types/domain/champion'

/** 分路筛选项；值与快照里的 LCU 大写命名一致 */
const POSITION_OPTIONS = [
  { label: '上单', value: 'TOP' },
  { label: '打野', value: 'JUNGLE' },
  { label: '中单', value: 'MIDDLE' },
  { label: '下路', value: 'BOTTOM' },
  { label: '辅助', value: 'UTILITY' }
]

/** 分路记在配置里：下次进来还落在同一条路 */
const POSITION_KEY = 'settings.opgg.position'
const DEFAULT_POSITION = 'MIDDLE'

const message = useMessage()
const metas = ref<ChampionMeta[]>([])
const options = ref<championOption[]>([])
const status = ref<OpggStatus | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const position = ref(DEFAULT_POSITION)
const keyword = ref('')
const sortKey = ref<SortKey>('default')
const sortDesc = ref(true)

const { tier, loading: tierLoading, switchTier, loadTier } = useOpggTier()

/** 英雄 id → 中文名 / 称号 / 别名，用于展示与搜索 */
const optionOf = (id: number) => options.value.find(o => o.value === id)
const nameOf = (id: number) => optionOf(id)?.realName || optionOf(id)?.label || `英雄 ${id}`
const textsOf = (id: number) => {
  const o = optionOf(id)
  return o ? [o.label, o.realName, o.nickname] : []
}

const rows = computed<TierRow[]>(() => {
  const base = toRows(metas.value, position.value, nameOf)
  return sortRows(filterRows(base, keyword.value, textsOf), sortKey.value, sortDesc.value)
})

/** 快照里一条数据都没有：给「数据未就绪」而不是空表格（空表格看着像「这版本没英雄」） */
const noData = computed(() => !loading.value && metas.value.length === 0)

const selected = ref<TierRow | null>(null)

async function load(): Promise<void> {
  loading.value = true
  metas.value = await listChampionMetas('ranked')
  status.value = await getOpggStatus('ranked')
  loading.value = false
}

async function refresh(): Promise<void> {
  refreshing.value = true
  await ensureOpggData('ranked')
  await load()
  refreshing.value = false
}

/** 段位切换失败时 composable 会回滚显示值，这里补一条用户可见的反馈 */
async function onTierChange(next: OpggTier): Promise<void> {
  const ok = await switchTier(next)
  if (!ok) message.error('段位数据拉取失败，已保持原段位显示')
}

/** 切分路即记住，下次进来还落在这条路 */
async function onPositionChange(next: string): Promise<void> {
  position.value = next
  await putConfigByIpc(POSITION_KEY, next)
}

/** 没设置过时后端给的是空串（不是 null）；空串与非法值一律落回默认分路 */
async function loadPosition(): Promise<void> {
  const saved = await getConfigByIpc(POSITION_KEY)
  if (typeof saved === 'string' && POSITION_OPTIONS.some(o => o.value === saved)) {
    position.value = saved
  }
}

/** 抽屉关闭即清空选中行：面板据此停掉取数、下次打开重新拉 */
function onDrawer(show: boolean): void {
  if (!show) selected.value = null
}

function onSort(key: SortKey): void {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else {
    sortKey.value = key
    sortDesc.value = true
  }
}

onMounted(async () => {
  options.value = await invoke<championOption[]>('get_champion_options')
  await loadPosition()
  await loadTier()
  await load()
})

// 段位切换后 useOpggTier 会 bump 版本号：榜单跟着重取
watch(opggRevision, () => void load())
</script>

<template>
  <div class="champions-page">
    <header class="champions-header">
      <div class="champions-heading">
        <h1 class="champions-title">英雄榜</h1>
        <span class="champions-meta">
          <template v-if="status">
            OP.GG · 版本 {{ status.patch }}
            <span v-if="status.stale" class="toolbar-stale">· 数据滞后</span>
          </template>
        </span>
      </div>
      <n-button size="small" quaternary :loading="refreshing" @click="refresh">刷新数据</n-button>
    </header>

    <!-- 工具栏不跟着滚：榜单有五六十行，滚下去还能随手换分路 / 段位 / 搜 -->
    <div class="champions-toolbar">
      <div class="position-tabs" role="tablist">
        <button
          v-for="o in POSITION_OPTIONS"
          :key="o.value"
          type="button"
          role="tab"
          class="position-tab"
          :class="{ 'position-tab-active': position === o.value }"
          :aria-selected="position === o.value"
          @click="onPositionChange(o.value)"
        >
          {{ o.label }}
        </button>
      </div>
      <div class="toolbar-right">
        <n-select
          :value="tier"
          :options="TIER_OPTIONS"
          :loading="tierLoading"
          :disabled="tierLoading"
          size="small"
          class="toolbar-select"
          @update:value="onTierChange"
        />
        <n-input
          :value="keyword"
          placeholder="搜索英雄名 / 别名"
          size="small"
          clearable
          class="toolbar-search"
          @update:value="(v: string) => (keyword = v)"
        />
      </div>
    </div>

    <div v-if="noData" class="champions-empty">
      <div>数据未就绪</div>
      <div class="champions-empty-hint">OP.GG 数据还没拉到，点「刷新数据」重试</div>
    </div>
    <ChampionTierTable
      v-else
      :rows="rows"
      :loading="loading"
      :sort-key="sortKey"
      :sort-desc="sortDesc"
      @select="(row: TierRow) => (selected = row)"
      @sort="onSort"
    />

    <n-drawer :show="!!selected" :width="600" placement="right" @update:show="onDrawer">
      <!-- 标题栏只留关闭按钮、去掉分隔线：英雄名由面板头部大字展示，不再重复一遍 -->
      <n-drawer-content
        closable
        :header-style="{ padding: '12px 16px 0', borderBottom: 'none' }"
        :body-content-style="{ padding: '0 24px 28px' }"
      >
        <ChampionDetailPanel :row="selected" :name-of="nameOf" />
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.champions-page {
  padding: var(--space-20) var(--space-24) 0;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 宽屏下不无限拉伸：列间距过大时一行数字对不上英雄 */
  max-width: 1180px;
  margin: 0 auto;
  width: 100%;
}

.champions-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-12);
  margin-bottom: var(--space-16);
  flex: none;
}

.champions-heading {
  display: flex;
  align-items: baseline;
  gap: var(--space-12);
}

.champions-title {
  margin: 0;
  font-size: var(--font-size-2xl);
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--text-primary);
}

.champions-meta {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.toolbar-stale {
  color: var(--semantic-loss);
}

.champions-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  margin-bottom: var(--space-16);
  flex-wrap: wrap;
  flex: none;
}

/* 分路是最常切换的维度：分段标签一眼看全五条路，比下拉少点一次 */
.position-tabs {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: var(--radius-md);
  background: var(--glass-bg-mid);
  border: 1px solid var(--glass-border);
}

.position-tab {
  min-width: 60px;
  height: 28px;
  padding: 0 var(--space-12);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-base);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
}

.position-tab:hover {
  color: var(--text-primary);
}

.position-tab-active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm), var(--glass-highlight);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.toolbar-select {
  width: 128px;
}

.toolbar-search {
  width: 220px;
}

.champions-empty {
  padding: var(--space-28);
  text-align: center;
  color: var(--text-secondary);
}

.champions-empty-hint {
  margin-top: var(--space-6);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
</style>
