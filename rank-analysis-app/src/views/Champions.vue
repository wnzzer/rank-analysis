<script setup lang="ts">
/**
 * 英雄榜：本版本（本段位、本分路）谁强
 *
 * 数据来自 OP.GG 列表快照（`list_champion_metas` 一次取齐约 400 行），筛选 / 搜索 /
 * 排序全在前端（见 `components/champions/championTier.ts`）——点列头即时重排。
 * 点某一行拉出抽屉看符文 / 出装 / 加点 / 苦手（`ChampionDetailDrawer`）。
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
    <div class="champions-toolbar">
      <span class="champions-title">英雄榜</span>
      <n-select
        :value="position"
        :options="POSITION_OPTIONS"
        size="small"
        class="toolbar-select"
        @update:value="onPositionChange"
      />
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
      <span class="toolbar-status">
        <template v-if="status">
          OP.GG {{ status.patch }}
          <span v-if="status.stale" class="toolbar-stale">（数据滞后）</span>
        </template>
      </span>
      <n-button size="small" tertiary :loading="refreshing" @click="refresh">刷新</n-button>
    </div>

    <div v-if="noData" class="champions-empty">
      <div>数据未就绪</div>
      <div class="champions-empty-hint">OP.GG 数据还没拉到，点「刷新」重试</div>
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

    <n-drawer :show="!!selected" :width="520" placement="right" @update:show="onDrawer">
      <n-drawer-content :title="selected ? `${selected.name} 详情` : ''" closable>
        <ChampionDetailPanel :row="selected" :name-of="nameOf" />
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.champions-page {
  padding: var(--space-16);
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 工具栏不跟着滚：榜单有五六十行，滚下去还能随手换分路 / 段位 / 搜 */
.champions-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-bottom: var(--space-12);
  flex-wrap: wrap;
  flex: none;
}

.champions-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  margin-right: var(--space-8);
}

.toolbar-select {
  width: 120px;
}

.toolbar-search {
  width: 200px;
}

.toolbar-status {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.toolbar-stale {
  color: var(--semantic-loss);
}

.champions-empty {
  padding: var(--space-24);
  text-align: center;
  color: var(--text-secondary);
}

.champions-empty-hint {
  margin-top: var(--space-6);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
</style>
