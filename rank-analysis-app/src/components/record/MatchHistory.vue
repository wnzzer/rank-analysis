<template>
  <div class="ratio-container">
    <div class="content-wrapper match-history-wrap">
      <!-- 工具栏三分区：筛选 / 视图 / 数据管理（设计系统 v3 §7.5） -->
      <div class="match-history-toolbar">
        <div class="mt-group mt-group--filters">
          <n-select
            v-model:value="filterQueueId"
            placeholder="按模式筛选"
            :options="modeOptions"
            size="small"
            class="filter-select filter-mode"
          />
          <n-select
            v-model:value="filterChampionId"
            filterable
            :filter="filterChampionFunc"
            placeholder="按英雄筛选"
            :render-tag="renderSingleSelectTag"
            :render-label="renderLabel"
            :options="championOptions"
            size="small"
            class="filter-select filter-champion"
          />
          <n-select
            v-model:value="filterResult"
            :options="RESULT_OPTIONS"
            size="small"
            class="filter-select filter-result"
          />
          <n-select
            v-model:value="filterTimeWindowHours"
            :options="TIME_WINDOW_OPTIONS"
            size="small"
            class="filter-select filter-time"
          />
        </div>

        <div class="mt-group mt-group--view">
          <div class="export-group">
            <n-button
              size="small"
              class="toolbar-export"
              :disabled="filteredGames.length === 0 || exporting"
              :title="`以「${exportFormatLabel(exportFormat)}」导出当前筛选的 ${filteredGames.length} 场对局`"
              @click="onExportSelect(exportFormat)"
            >
              <template #icon>
                <n-icon :size="13"><Download /></n-icon>
              </template>
              {{ exporting ? '导出中…' : `导出 · ${exportFormatLabel(exportFormat)}` }}
            </n-button>
            <n-dropdown trigger="click" :options="exportOptions" @select="onFormatPick">
              <n-button
                size="small"
                class="export-caret"
                :disabled="exporting"
                title="选择导出格式"
                aria-label="选择导出格式"
              >
                <template #icon>
                  <n-icon :size="12"><ChevronDown /></n-icon>
                </template>
              </n-button>
            </n-dropdown>
          </div>
          <n-button size="small" class="toolbar-expand-all" @click="toggleExpandAll">
            {{ anyExpanded ? '收起全部' : '展开全部' }}
          </n-button>
          <div class="pagination">
            <n-pagination>
              <template #prev>
                <n-button
                  size="tiny"
                  :disabled="page == 1 || isRequestingMatchHostory"
                  @click="prevPage"
                >
                  <template #icon>
                    <n-icon>
                      <ArrowLeft></ArrowLeft>
                    </n-icon>
                  </template>
                </n-button>
              </template>
              <template #label>
                <span>{{ page }}/{{ pageCount }}</span>
              </template>
              <template #next>
                <n-button
                  size="tiny"
                  @click="nextPage"
                  :disabled="noMoreMatches || isRequestingMatchHostory"
                >
                  <template #icon>
                    <n-icon>
                      <ArrowRight></ArrowRight>
                    </n-icon>
                  </template>
                </n-button>
              </template>
            </n-pagination>
          </div>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button quaternary circle size="small" class="toolbar-reset" @click="resetFilter">
                <n-icon><Repeat /></n-icon>
              </n-button>
            </template>
            复位
          </n-tooltip>
        </div>

        <div class="mt-group mt-group--data">
          <n-button
            v-if="sgpRegion"
            size="small"
            class="toolbar-collect"
            :disabled="collectDone"
            @click="toggleCollectAll"
          >
            {{ collectLabel }}
          </n-button>
          <n-popconfirm v-if="sgpRegion && hasCollected" @positive-click="handleClearCollected">
            <template #trigger>
              <n-button size="small" class="toolbar-clear-collected" :disabled="isCollectingAll">
                清空已收
              </n-button>
            </template>
            将删除该区/该召唤师已收集的全部对局缓存，列表回到最近 50 场窗口。确定清空？
          </n-popconfirm>
        </div>
      </div>

      <Transition name="list">
        <div v-if="lastExportPath" class="export-path-bar">
          <span class="export-path-label">已导出</span>
          <span class="export-path-text" :title="lastExportPath">{{ lastExportPath }}</span>
          <button class="export-path-copy" @click="copyExportPath">
            {{ pathCopied ? '已复制' : '复制路径' }}
          </button>
          <button class="export-path-close" aria-label="关闭" @click="lastExportPath = null">
            ✕
          </button>
        </div>
      </Transition>

      <TrendBar
        :games="trendFiltered"
        :champion-options="championOptions"
        class="match-history-trend"
        @select-game="selectTrendGame"
      />

      <template v-if="isRequestingMatchHostory && !matchHistory">
        <div class="match-history-list">
          <RecordCardSkeleton v-for="i in 10" :key="`skel-${i}`" />
        </div>
      </template>
      <template v-else-if="loadError">
        <EmptyState
          :icon="TriangleAlert"
          title="加载失败"
          description="网络或客户端暂时不可用，稍后可重试。"
        >
          <template #art><TriangleAlert /></template>
          <template #action>
            <n-button size="small" @click="retry">重试</n-button>
          </template>
        </EmptyState>
      </template>
      <template v-else-if="games.length === 0 && hasFilter">
        <EmptyState
          :icon="Search"
          title="没有匹配的对局"
          description="试试放宽筛选条件，或清除筛选查看全部对局。"
        >
          <template #art><Search /></template>
          <template #action>
            <n-button size="small" @click="resetFilter">清除筛选</n-button>
          </template>
        </EmptyState>
      </template>
      <TransitionGroup v-else name="list" tag="div" class="match-history-list">
        <div
          v-for="(game, index) in games"
          :key="game.gameId"
          :style="{ '--stagger-i': index }"
          :data-game-id="game.gameId"
          class="list-item"
        >
          <RecordCard
            :record-type="true"
            :games="game"
            :champion-options="championOptions"
            :expanded="expandedGameIds.has(game.gameId)"
            :selected="props.selectedId === game.gameId"
            :class="{ 'list-item-flash': highlightedGameId === game.gameId }"
            @open-detail="toggleDetail(game)"
            @hover-champion="emit('hover-champion', $event)"
            @leave-champion="emit('leave-champion')"
          />
          <Transition name="detail-expand">
            <MatchDetailInline
              v-if="expandedGameIds.has(game.gameId)"
              :game="game"
              :region="region"
              @close="collapseDetail(game.gameId)"
            />
          </Transition>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import RecordCard from './RecordCard.vue'
import RecordCardSkeleton from './RecordCardSkeleton.vue'
import TrendBar from './TrendBar.vue'
import { ArrowLeft, ArrowRight, Repeat, Download, ChevronDown } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { NButton, NIcon, NDropdown, useLoadingBar, useMessage } from 'naive-ui'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { Search, TriangleAlert } from 'lucide-vue-next'
import {
  exportMatches,
  gamesToCsv,
  loadExportFormat,
  saveExportFormat,
  type ExportFormat
} from '@renderer/utils/exportMatches'

const FORMATS_SET: Set<string> = new Set(['csv', 'csv-full', 'json'])

// 导出结果仅为装饰性反馈：部分单测宿主无 n-message-provider，
// useMessage 在缺 provider 时会抛错，这里容错降级为不提示
const messageApi = (() => {
  try {
    return useMessage()
  } catch {
    return null
  }
})()
import { useRoute } from 'vue-router'
import { renderSingleSelectTag, renderLabel, filterChampionFunc } from '../composition'
import { modeOptions, initModeOptions } from './composition'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc } from '@renderer/services/ipc'
import { getGameById } from '@renderer/features/record/services/gameById'
import {
  getSgpMatchHistoryByName,
  getCurrentSgpRegion,
  mergeGamesByGameId,
  collectSgpHistoryAll,
  loadCollectedGames,
  saveCollectedGames,
  clearCollectedGames
} from '@renderer/features/record/services/sgp'
import { championOption } from '../type'
import type { Game, MatchHistory } from './match'
import MatchDetailInline from './MatchDetailInline.vue'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'
import {
  filterMatches,
  hasActiveFilter,
  RESULT_OPTIONS,
  TIME_WINDOW_OPTIONS,
  type MatchFilterState
} from './matchFilters'
import { aggregateChampionPool, type ChampionPoolEntry } from './championPool'
import { computePageSize, DEFAULT_PAGE_SIZE, type MatchPageMode } from './pageSize'
import { CONFIG_KEYS } from '@renderer/services/configKeys'

/** 英雄池联动：hover 行卡时把当前英雄 id 上抛给父级（左栏 HeroPool 高亮/展开） */
const emit = defineEmits<{
  'hover-champion': [championId: number]
  'leave-champion': []
  'pool-change': [entries: ChampionPoolEntry[]]
  'games-change': [games: Game[]]
  /** 外部请求聚焦某场对局（宿敌/胜率弹窗点击）：已定位并就地展开后回执 */
  'focus-handled': []
  /** 外部请求按英雄筛选（英雄池点击）：已应用后回执 */
  'champion-filter-handled': []
  /** 筛选状态变化（英雄筛选生效/清除），供左栏英雄池同步选中态 */
  'filter-change': [filter: MatchFilterState]
  /** v2 宽屏详情栏：卡片点选上抛（null = 取消选中） */
  select: [game: Game | null]
}>()

const props = defineProps<{
  /** 宿敌/胜率弹窗点击对局：非 null 时定位该对局并就地展开（一次性命令） */
  focusGameId?: number | null
  /** 英雄池点击：非 0 时按该英雄筛选，与当前选中相同则取消（一次性命令） */
  championFilter?: number
  /** v3 宽屏双栏范式开关（父级计算 isCompact 后下发） */
  v2Wide?: boolean
  /** v2 宽屏下当前右侧详情栏选中的对局 id（回显选中态） */
  selectedId?: number | null
}>()

/**
 * 父级批量加载：一次性收集当前页所有战绩的 item/spell/perk ID 去重后下发 IPC。
 * 收集全部参与者（10 人）而非只取 participants[0]——详情抽屉就地展开时
 * 10 人装备/符文/召唤师技能图标要"开箱即显"，不能再让抽屉里逐个补 preload。
 */
const recordAssets = useRecordAssets()
provide(recordAssetsKey, recordAssets)

function collectAssetIds(games: Game[] | undefined) {
  const items = new Set<number>()
  const spells = new Set<number>()
  const perks = new Set<number>()
  for (const g of games ?? []) {
    for (const participant of g.participants) {
      const s = participant?.stats
      if (!s) continue
      ;[s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].forEach(id => {
        if (id > 0) items.add(id)
      })
      ;[participant.spell1Id, participant.spell2Id].forEach(id => {
        if (id > 0) spells.add(id)
      })
      ;[
        s.playerAugment1,
        s.playerAugment2,
        s.playerAugment3,
        s.playerAugment4,
        s.playerAugment5,
        s.playerAugment6
      ].forEach(id => {
        if (id > 0) perks.add(id)
      })
    }
  }
  return {
    items: [...items],
    spells: [...spells],
    perks: [...perks]
  }
}

/**
 * 筛选状态：模式 / 英雄走 LCU 拉取口径（queueId 0 = 全部；championId 0 = 全部，
 * 原 -1 语义统一到 0），胜负 / 时间窗口纯前端过滤。四维共用 matchFilters 纯函数，
 * 趋势条与列表严格同源。
 */
const filterQueueId = ref(0)
const filterChampionId = ref(0)
const filterResult = ref<MatchFilterState['result']>('all')
const filterTimeWindowHours = ref(0)
const championOptions = ref<championOption[]>([])

const activeFilter = computed<MatchFilterState>(() => ({
  queueId: filterQueueId.value,
  championId: filterChampionId.value,
  result: filterResult.value,
  timeWindowHours: filterTimeWindowHours.value
}))

const hasFilter = computed(() => hasActiveFilter(activeFilter.value))

/** 最近 50 场全量（时间降序），列表 / 趋势条 / 英雄池同源 */
const allGames = ref<Game[]>([])
const matchHistory = ref<MatchHistory>()
/** 已就地展开详情（多开）的对局 id 集合；切换玩家/筛选时清空 */
const expandedGameIds = ref<Set<number>>(new Set())
const loadingBar = useLoadingBar()
const isRequestingMatchHostory = ref(false)
const loadError = ref(false)

/** 客户端分页：过滤后切片；每页条数由设置决定（auto=按窗口高度动态 / fixed=手动固定，默认 10） */
const page = ref(1)
const pageMode = ref<MatchPageMode>('fixed')
const fixedPageSize = ref(DEFAULT_PAGE_SIZE)
/** 可视高度：auto 模式动态条数的输入（resize 时更新） */
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 800)
/** 每页条数：auto 模式下随窗口高度变化，触发分页切片自动重算 */
const PAGE_SIZE = computed(() =>
  computePageSize(viewportHeight.value, pageMode.value, fixedPageSize.value)
)

const filteredGames = computed(() => filterMatches(allGames.value, activeFilter.value))
const pageCount = computed(() =>
  Math.max(1, Math.ceil(filteredGames.value.length / PAGE_SIZE.value))
)
const games = computed(() =>
  filteredGames.value.slice((page.value - 1) * PAGE_SIZE.value, page.value * PAGE_SIZE.value)
)

/** 已到最后一页（按过滤后的命中总数判断） */
const noMoreMatches = computed(() => page.value >= pageCount.value)

/** 跨区(SGP)已拉取的场次窗口起点：每次「收集更多」向后端追加拉取（SGP 无 50 场上限） */
const sgpStartIndex = ref(0)

/** 趋势条：与列表共用同一份过滤（客户端过滤不重拉） */
const trendFiltered = computed(() => filteredGames.value)

/** 导出当前筛选对局（格式记忆：主按钮按上次格式直出，▾ 重选并记忆） */
const exporting = ref(false)
/** 最近一次导出的落盘路径：工具栏下方展示，可一键复制 */
const lastExportPath = ref<string | null>(null)
const pathCopied = ref(false)
const exportFormat = ref<ExportFormat>(loadExportFormat())
const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV 基础',
  'csv-full': 'CSV 完整',
  json: 'JSON'
}
function exportFormatLabel(f: ExportFormat): string {
  return FORMAT_LABELS[f] ?? f
}
const exportOptions = [
  ...(Object.keys(FORMAT_LABELS) as ExportFormat[]).map(key => ({
    label: FORMAT_LABELS[key],
    key
  })),
  { type: 'divider' as const, key: 'd-clip' },
  { label: '复制 CSV 到剪贴板', key: 'clipboard' }
]
function onFormatPick(format: string) {
  if ((FORMATS_SET as Set<string>).has(format)) {
    exportFormat.value = format as ExportFormat
    saveExportFormat(exportFormat.value)
  } else if (format === 'clipboard') {
    void copyCsvToClipboard()
  }
}
async function copyCsvToClipboard(): Promise<void> {
  if (filteredGames.value.length === 0) return
  try {
    await navigator.clipboard.writeText(
      gamesToCsv(
        filteredGames.value,
        id => championOptions.value.find(o => o.value === id)?.label ?? `英雄 ${id}`
      ).replace(/^\uFEFF/, '')
    )
    messageApi?.success(`已复制 ${filteredGames.value.length} 场对局 CSV`)
  } catch {
    messageApi?.error('剪贴板不可用，请改用文件导出')
  }
}
async function onExportSelect(format: string) {
  if (exporting.value || filteredGames.value.length === 0) return
  exporting.value = true
  try {
    const result = await exportMatches(
      filteredGames.value,
      id => championOptions.value.find(o => o.value === id)?.label ?? `英雄 ${id}`,
      { format: format as ExportFormat }
    )
    if (result.status === 'saved') {
      lastExportPath.value = result.path
      pathCopied.value = false
      messageApi?.success(`已导出 ${filteredGames.value.length} 场对局`)
    }
  } catch (e) {
    console.error('导出失败:', e)
    messageApi?.error(typeof e === 'string' ? e : '导出失败，请重试')
  } finally {
    exporting.value = false
  }
}

async function copyExportPath(): Promise<void> {
  if (!lastExportPath.value) return
  try {
    await navigator.clipboard.writeText(lastExportPath.value)
    pathCopied.value = true
    setTimeout(() => (pathCopied.value = false), 1500)
  } catch {
    messageApi?.error('复制失败，请手动选择路径文本')
  }
}

/** 英雄池：从最近 50 场聚合（供左栏 HeroPool 联动，不改动 50 场窗口口径） */
const championPool = computed<ChampionPoolEntry[]>(() => aggregateChampionPool(allGames.value))

watch(championPool, pool => emit('pool-change', pool), { immediate: true })

/** 全量对局上抛（D-P3 分时曲线数据源）：每次引用变化（新拉/收集/重置）通知父级 */
watch(allGames, games => emit('games-change', games), { immediate: true })

/** 点击趋势格后的高亮对局 id（列表内定位用，闪烁后清除） */
const highlightedGameId = ref<number | null>(null)

const route = useRoute()
const name = computed(() => (route.query.name as string) ?? '')
/** 跨区查询目标大区 platformId（空 = 当前区，走本地 LCU；非空走 SGP 跨区） */
const region = computed(() => (route.query.region as string) ?? '')
/** 当前登录客户端所在大区 platformId（如 `HN10`）：本区 50 场窗口翻完后续拉 SGP 用 */
const currentRegion = ref('')

/** 实际使用的 SGP 目标大区：显式跨区优先，否则退回当前登录区（本区深翻页） */
const sgpRegion = computed(() => region.value || currentRegion.value)

const resetFilter = () => {
  filterQueueId.value = 0
  filterChampionId.value = 0
  filterResult.value = 'all'
  filterTimeWindowHours.value = 0
  page.value = 1
}

/** 筛选生效/清除时同步给父级（左栏英雄池选中态跟随英雄筛选） */
watch(
  () => [
    filterQueueId.value,
    filterChampionId.value,
    filterResult.value,
    filterTimeWindowHours.value
  ],
  () => emit('filter-change', activeFilter.value),
  { immediate: true }
)

/**
 * 英雄池点击（一次性命令）：与当前选中英雄相同则取消，否则按该英雄筛选。
 * 应用后立即回执，让父级清空命令位以便再次点击同一英雄可切换。
 */
watch(
  () => props.championFilter,
  id => {
    if (!id || id <= 0) return
    if (filterChampionId.value === id) {
      filterChampionId.value = 0
    } else {
      filterChampionId.value = id
    }
    page.value = 1
    emit('champion-filter-handled')
  }
)

/**
 * 聚焦某场对局（宿敌/胜率弹窗点击）：清空筛选保证可见 → 定位所在页 →
 * 就地展开 → 平滑滚动并闪烁高亮。目标不在已拉取的窗口内时按 gameId 补拉并前置。
 */
async function focusGame(gameId: number): Promise<void> {
  if (!allGames.value.some(g => g.gameId === gameId)) {
    const fetched = await getGameById(gameId)
    if (fetched && !allGames.value.some(g => g.gameId === gameId)) {
      allGames.value = [fetched, ...allGames.value]
    }
    if (!fetched) {
      emit('focus-handled')
      return
    }
  }
  resetFilter()
  const idx = filteredGames.value.findIndex(g => g.gameId === gameId)
  if (idx < 0) {
    emit('focus-handled')
    return
  }
  page.value = Math.floor(idx / PAGE_SIZE.value) + 1
  expandedGameIds.value.add(gameId)
  expandedGameIds.value = new Set(expandedGameIds.value)
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(`[data-game-id="${gameId}"]`)
    if (!el) return
    highlightedGameId.value = gameId
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => {
      if (highlightedGameId.value === gameId) highlightedGameId.value = null
    }, 1600)
  })
  emit('focus-handled')
}

/** 宿敌/胜率弹窗点击对局（一次性命令） */
watch(
  () => props.focusGameId,
  id => {
    if (id == null || id <= 0) return
    void focusGame(id)
  }
)

/** 行卡点击：已展开则收起，未展开则就地展开（允许多开）；
 *  v3 宽屏双栏（v2Wide）下改为单选上抛，不再内嵌展开 */
function toggleDetail(game: Game) {
  if (props.v2Wide) {
    const same = props.selectedId === game.gameId
    emit('select', same ? null : game)
    return
  }
  if (expandedGameIds.value.has(game.gameId)) {
    expandedGameIds.value.delete(game.gameId)
  } else {
    expandedGameIds.value.add(game.gameId)
  }
  expandedGameIds.value = new Set(expandedGameIds.value)
}

function collapseDetail(gameId: number) {
  expandedGameIds.value.delete(gameId)
  expandedGameIds.value = new Set(expandedGameIds.value)
}

/** 是否已有任意对局就地展开（控制「展开全部 / 收起全部」按钮文案） */
const anyExpanded = computed(() => expandedGameIds.value.size > 0)

/**
 * 一键展开全部 / 收起全部：对当前筛选命中的所有对局批量就地展开，
 * 再点一次全部收起（含此前手动单开的）。
 */
function toggleExpandAll() {
  if (anyExpanded.value) {
    expandedGameIds.value = new Set()
    return
  }
  expandedGameIds.value = new Set(filteredGames.value.map(g => g.gameId))
}

// 获取最近 50 场（一次拉取，列表分页/趋势条/英雄池共用）
const getHistoryMatch = async (name: string) => {
  collectGeneration.value++ // 作废进行中的全量收集（结果丢弃）
  collectDone.value = false
  collectCancelRequested.value = false
  loadingBar.start()
  isRequestingMatchHostory.value = true
  loadError.value = false
  try {
    let result: MatchHistory | null = null
    if (region.value) {
      result = await getSgpMatchHistoryByName(region.value, name, 0, 50)
      if (!result) throw new Error('SGP 跨区查询失败')
      // 恢复上次「收集全部」的持久化成果：已存集合（上次收集到的全量）比本次 50 场窗口
      // 更全，直接合并展示；续收游标对齐到恢复后的总数，从上次收尾处继续拉取
      const saved = await loadCollectedGames(region.value, name)
      hasCollected.value = !!saved
      if (saved) {
        const merged = mergeGamesByGameId(result.games?.games ?? [], saved)
        result = { ...result, games: { ...result.games, games: merged } }
      }
      sgpStartIndex.value = result.games?.games?.length ?? 50
    } else {
      result = await invoke<MatchHistory>('get_match_history_by_name', {
        name,
        begIndex: 0,
        endIndex: 49
      })
      // 本区（LCU 50 场窗口）也恢复「收集全部」的持久化成果，续收游标对齐
      const saved = await loadCollectedGames(sgpRegion.value, name)
      hasCollected.value = !!saved
      if (saved) {
        const merged = mergeGamesByGameId(result.games?.games ?? [], saved)
        result = { ...result, games: { ...result.games, games: merged } }
      }
      sgpStartIndex.value = result.games?.games?.length ?? 50
    }
    matchHistory.value = result
    allGames.value = matchHistory.value?.games?.games ?? []
    page.value = 1
    expandedGameIds.value = new Set()
  } catch (err) {
    loadError.value = true
    loadingBar.error()
    console.error('[MatchHistory] getHistoryMatch failed', err)
  } finally {
    isRequestingMatchHostory.value = false
    if (!loadError.value) {
      loadingBar.finish()
    }
  }
}

/**
 * 重试当前页加载（点击"加载失败"空态下的"重试"按钮触发）
 */
async function retry() {
  await getHistoryMatch(name.value)
}

watch(
  () => matchHistory.value,
  mh => {
    const { items, spells, perks } = collectAssetIds(mh?.games?.games)
    recordAssets.preload([
      { kind: 'item', ids: items },
      { kind: 'spell', ids: spells },
      { kind: 'perk', ids: perks }
    ])
  }
)

// 下一页 / 上一页（纯客户端切片，50 场窗口内翻页；窗口末尾时跨区/本区都转 SGP 追加拉取）
const nextPage = () => {
  if (region.value || noMoreMatches.value) {
    if (!sgpRegion.value || isRequestingSgpMore.value || isCollectingAll.value) return
    loadMoreCrossRegion()
    return
  }
  page.value += 1
}

/** 深翻页：SGP 无 50 场上限，「收集更多」按 startIndex 追加拉取，gameId 去重合并。
 * 跨区查目标区；本区 50 场窗口翻完后也转 SGP（用当前登录区 platformId）。 */
const isRequestingSgpMore = ref(false)
const loadMoreCrossRegion = async () => {
  if (isRequestingSgpMore.value || isCollectingAll.value) return
  if (!sgpRegion.value) return
  isRequestingSgpMore.value = true
  try {
    const mh = await getSgpMatchHistoryByName(sgpRegion.value, name.value, sgpStartIndex.value, 50)
    if (!mh) throw new Error('SGP 跨区追加拉取失败')
    const incoming = mh.games?.games ?? []
    if (incoming.length === 0) {
      sgpStartIndex.value = -1 // 无更多：标记终止，后续点击直接翻页
      page.value = pageCount.value
      return
    }
    const merged = mergeGamesByGameId(allGames.value, incoming)
    if (merged.length > allGames.value.length) {
      allGames.value = merged
      page.value = pageCount.value // 翻到追加内容所在的最后一页
    }
    sgpStartIndex.value += incoming.length
  } catch (err) {
    console.error('[MatchHistory] loadMoreCrossRegion failed', err)
    loadingBar.error()
  } finally {
    isRequestingSgpMore.value = false
  }
}

/** collectMode：跨区一键全量收集（解除 50 场窗口），趋势条/英雄池/分页同源扩展 */
const isCollectingAll = ref(false)
/** 自然收尾（拉空批次）后按钮禁用；上限截断可再点续收 */
const collectDone = ref(false)
/** 是否有已持久化的跨区收集成果（决定「清空已收」按钮显隐） */
const hasCollected = ref(false)
/** 手动取消请求：收集循环每轮检查，下一页前退出 */
const collectCancelRequested = ref(false)
/** 世代号：切换玩家/卸载时 +1，使进行中的收集作废（结果丢弃、循环退出） */
const collectGeneration = ref(0)

const collectLabel = computed(() => {
  if (isCollectingAll.value) return `收集中 ${allGames.value.length} 场…`
  if (collectDone.value) return `已全量 ${allGames.value.length} 场`
  if (sgpStartIndex.value > 50 || sgpStartIndex.value === -1) return '继续收集'
  return '收集全部'
})

const toggleCollectAll = async () => {
  if (isCollectingAll.value) {
    collectCancelRequested.value = true // 收集中再次点击 = 取消
    return
  }
  if (!sgpRegion.value) return
  collectCancelRequested.value = false
  isCollectingAll.value = true
  const gen = collectGeneration.value
  try {
    const result = await collectSgpHistoryAll({
      region: sgpRegion.value,
      name: name.value,
      startIndex: sgpStartIndex.value,
      initialGames: allGames.value,
      onPage: merged => {
        allGames.value = merged
      },
      shouldContinue: () => collectGeneration.value === gen && !collectCancelRequested.value
    })
    if (collectGeneration.value !== gen) return // 已切换玩家/卸载，丢弃结果
    allGames.value = result.games
    sgpStartIndex.value = result.nextStartIndex
    collectDone.value = result.reachedEnd
    page.value = pageCount.value
    // 收集完成（或中途取消的已有成果）落库，重启后可恢复，无需重新拉取
    void saveCollectedGames(sgpRegion.value, name.value, result.games)
    hasCollected.value = result.games.length > 0
  } catch (err) {
    console.error('[MatchHistory] toggleCollectAll failed', err)
    loadingBar.error()
  } finally {
    isCollectingAll.value = false
  }
}

/** 清空已收集：删掉落库成果后回到 50 场窗口（失败时保留现状，可重试） */
async function handleClearCollected() {
  if (isCollectingAll.value) return
  const ok = await clearCollectedGames(sgpRegion.value, name.value)
  if (!ok) {
    loadingBar.error()
    return
  }
  hasCollected.value = false
  await getHistoryMatch(name.value)
}

const prevPage = () => {
  page.value = Math.max(1, page.value - 1)
}

/**
 * 加载每页条数设置（mode + fixed 条数），失败时保持默认（fixed 10）
 */
async function loadPageSizeConfig() {
  try {
    const mode = await getConfigByIpc<MatchPageMode>(CONFIG_KEYS.matchPageMode)
    if (mode === 'auto' || mode === 'fixed') pageMode.value = mode
  } catch (err) {
    console.error('[MatchHistory] load page mode failed', err)
  }
  try {
    const size = await getConfigByIpc<number>(CONFIG_KEYS.matchPageSize)
    if (typeof size === 'number' && size >= 1) fixedPageSize.value = size
  } catch (err) {
    console.error('[MatchHistory] load page size failed', err)
  }
  if (pageMode.value === 'auto') {
    viewportHeight.value = window.innerHeight
    window.addEventListener('resize', onViewportResize)
  }
}

/** auto 模式跟随窗口高度变化，动态调整每页条数（切片随 PAGE_SIZE 重算） */
function onViewportResize() {
  viewportHeight.value = window.innerHeight
}

/**
 * 趋势格点击：目标局在当前页列表 → 平滑滚动并闪烁高亮；
 * 不在当前页（更早的对局）→ 翻到所在页并就地展开详情，待渲染后回滚定位。
 */
function selectTrendGame(gameId: number) {
  const target = document.querySelector<HTMLElement>(`[data-game-id="${gameId}"]`)
  if (target) {
    highlightedGameId.value = gameId
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => {
      if (highlightedGameId.value === gameId) highlightedGameId.value = null
    }, 1600)
    return
  }
  const game = allGames.value.find(g => g.gameId === gameId)
  if (!game) return
  const idx = filteredGames.value.findIndex(g => g.gameId === gameId)
  if (idx < 0) return
  page.value = Math.floor(idx / PAGE_SIZE.value) + 1
  expandedGameIds.value.add(gameId)
  expandedGameIds.value = new Set(expandedGameIds.value)
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(`[data-game-id="${gameId}"]`)
    if (!el) return
    highlightedGameId.value = gameId
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => {
      if (highlightedGameId.value === gameId) highlightedGameId.value = null
    }, 1600)
  })
}

onMounted(async () => {
  await initModeOptions()
  championOptions.value = await invoke<championOption[]>('get_champion_options')
  await loadPageSizeConfig()
  // 本区深翻页依赖当前登录大区 platformId（SGP 网关支持本区查询）
  currentRegion.value = (await getCurrentSgpRegion()) ?? ''
  await getHistoryMatch(name.value)
})

onBeforeUnmount(() => {
  collectGeneration.value++ // 卸载即作废进行中的全量收集
  window.removeEventListener('resize', onViewportResize)
})

// 切换玩家（路由 name 变化）时列表与趋势条一起刷新
watch(
  () => route.query.name,
  newName => {
    if (newName && typeof newName === 'string') {
      getHistoryMatch(newName)
    }
  }
)
</script>

<style lang="css" scoped>
.ratio-container {
  width: 100%;
  height: 100%;
  padding: 0;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.match-history-wrap.content-wrapper {
  height: 100%;
  position: relative;
  gap: var(--space-20);
}

.match-history-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-8);
  flex-wrap: wrap;
}

/* 三分区：筛选 / 视图 / 数据管理，组间细分隔线（设计系统 v3 §7.5） */
.mt-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
}
.mt-group + .mt-group {
  padding-left: var(--space-10);
  border-left: 1px solid var(--border-subtle);
}
.mt-group--data .toolbar-collect {
  font-weight: var(--font-weight-semibold);
}

.match-history-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.match-history-empty {
  padding: var(--space-24) 0;
}

.match-history-trend {
  flex-shrink: 0;
}

.list-item {
  /* TransitionGroup child; stagger via --stagger-i */
}

/* 趋势格点击定位后的闪烁高亮（1.6s 后由 highlightedGameId 清除） */
.list-item-flash {
  animation: list-flash 1.6s var(--ease-expo);
}

@keyframes list-flash {
  0%,
  55% {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--accent-gold-deep) 65%, transparent),
      var(--shadow-md);
  }
  100% {
    box-shadow: var(--shadow-sm);
  }
}

.list-enter-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
  transition-delay: calc(var(--stagger) * var(--stagger-i, 0));
}

.list-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.list-move {
  transition: transform var(--dur-normal) var(--ease-expo);
}

/* 行内展开/收起过渡：淡入 + 轻微下滑（高度动画交给浏览器 flex/auto 布局） */
.detail-expand-enter-active,
.detail-expand-leave-active {
  transition:
    opacity var(--dur-normal) var(--ease-expo),
    transform var(--dur-normal) var(--ease-expo);
}

.detail-expand-enter-from,
.detail-expand-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.filter-select.filter-mode {
  width: 100px;
  margin-left: var(--space-8);
}

.filter-select.filter-champion {
  width: 150px;
}

.filter-select.filter-result {
  width: 76px;
}

.filter-select.filter-time {
  width: 100px;
}

/* 窄窗：筛选器与按钮压缩宽度，配合工具栏 wrap 防止溢出 */
@media (max-width: 700px) {
  .filter-select.filter-mode {
    width: 88px;
  }

  .filter-select.filter-champion {
    width: 120px;
  }

  .filter-select.filter-result {
    width: 68px;
  }

  .filter-select.filter-time {
    width: 88px;
  }
}

.toolbar-more {
  margin-left: auto;
  font-size: var(--font-size-2xs);
  background: var(--glass-bg-low) !important;
  border: 1px solid var(--glass-border) !important;
  color: var(--text-secondary);
}

.export-group {
  display: inline-flex;
  align-items: center;
}

.export-group .toolbar-export {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.export-group .export-caret {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  margin-left: -1px;
}

.toolbar-expand-all {
  font-size: var(--font-size-2xs);
  background: var(--glass-bg-low) !important;
  border: 1px solid var(--glass-border) !important;
  color: var(--text-secondary);
  transition:
    color var(--dur-fast) var(--ease-expo),
    border-color var(--dur-fast) var(--ease-expo);
}

.toolbar-expand-all:hover {
  color: var(--text-primary);
  border-color: var(--accent-gold-deep) !important;
}

.toolbar-more:hover {
  color: var(--text-primary);
  background: var(--glass-bg-mid) !important;
}

.filter-select :deep(.n-input),
.filter-select :deep(.n-input-wrapper) {
  transition:
    border-color var(--dur-fast) var(--ease-expo),
    box-shadow var(--dur-fast) var(--ease-expo);
}

.filter-select:focus-within :deep(.n-input-wrapper) {
  box-shadow: 0 0 0 1px var(--border-subtle);
}

.filter-select :deep(.n-base-selection) {
  background: var(--glass-bg-low) !important;
  border-color: var(--glass-border) !important;
  transition: border-color var(--dur-fast) var(--ease-expo) !important;
}
.filter-select :deep(.n-base-selection:hover) {
  border-color: var(--glass-bg-high) !important;
}

.toolbar-reset {
  color: var(--text-secondary);
  transition:
    transform var(--dur-fast) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
}

.toolbar-reset:hover {
  transform: scale(1.05) rotate(180deg);
  transition:
    transform var(--dur-normal) var(--ease-expo),
    color var(--dur-fast) var(--ease-expo);
  color: var(--text-primary);
}

.toolbar-reset:active {
  transform: scale(0.98) rotate(180deg);
}

.content-wrapper {
  width: 100%;
  margin: auto;
  position: relative;
}

.pagination {
  display: inline-flex;
  align-items: center;
}

.pagination :deep(.n-button) {
  background: var(--glass-bg-low) !important;
  border: 1px solid var(--glass-border) !important;
}

.export-path-bar {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: 6px var(--space-10);
  margin-bottom: var(--space-12);
  background: var(--brand-soft);
  border: 1px solid var(--brand-border);
  clip-path: var(--clip-notch);
}
.export-path-label {
  flex: none;
  font-size: var(--font-size-2xs);
  font-weight: 700;
  color: var(--brand);
  letter-spacing: var(--tracking-label);
}
.export-path-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  font-family: 'Space Mono', 'Bahnschrift', monospace;
  font-size: var(--font-size-2xs);
  color: var(--text-secondary);
  user-select: text;
}
.export-path-copy,
.export-path-close {
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-2xs);
}
.export-path-copy:hover {
  color: var(--brand);
}
</style>
