<template>
  <div class="ratio-container">
    <n-flex vertical class="content-wrapper match-history-wrap">
      <n-flex class="match-history-toolbar" align="center" :size="8" :wrap="false">
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
        <n-button size="small" class="toolbar-expand-all" @click="toggleExpandAll">
          {{ anyExpanded ? '收起全部' : '展开全部' }}
        </n-button>
        <n-button size="small" class="toolbar-more" @click="nextPage">收集更多</n-button>
        <n-button
          v-if="region"
          size="small"
          class="toolbar-collect"
          :disabled="collectDone"
          @click="toggleCollectAll"
        >
          {{ collectLabel }}
        </n-button>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button quaternary circle size="small" class="toolbar-reset" @click="resetFilter">
              <n-icon><RepeatOutline /></n-icon>
            </n-button>
          </template>
          复位
        </n-tooltip>
      </n-flex>

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
        <n-empty description="加载失败" class="match-history-empty">
          <template #extra>
            <n-button size="small" @click="retry">重试</n-button>
          </template>
        </n-empty>
      </template>
      <template v-else-if="games.length === 0 && hasFilter">
        <n-empty description="没有匹配的对局" class="match-history-empty">
          <template #extra>
            <n-button size="small" @click="resetFilter">清除筛选</n-button>
          </template>
        </n-empty>
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
                  <ArrowBack></ArrowBack>
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
                  <ArrowForward></ArrowForward>
                </n-icon>
              </template>
            </n-button>
          </template>
        </n-pagination>
      </div>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import RecordCard from './RecordCard.vue'
import RecordCardSkeleton from './RecordCardSkeleton.vue'
import TrendBar from './TrendBar.vue'
import { ArrowBack, ArrowForward, RepeatOutline } from '@vicons/ionicons5'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { NEmpty, NButton, useLoadingBar } from 'naive-ui'
import { useRoute } from 'vue-router'
import { renderSingleSelectTag, renderLabel, filterChampionFunc } from '../composition'
import { modeOptions, initModeOptions } from './composition'
import { invoke } from '@tauri-apps/api/core'
import {
  getSgpMatchHistoryByName,
  mergeGamesByGameId,
  collectSgpHistoryAll
} from '@renderer/services/sgp'
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
}>()

const props = defineProps<{
  /** 宿敌/胜率弹窗点击对局：非 null 时定位该对局并就地展开（一次性命令） */
  focusGameId?: number | null
  /** 英雄池点击：非 0 时按该英雄筛选，与当前选中相同则取消（一次性命令） */
  championFilter?: number
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

/** 客户端分页：过滤后切片，每页 10 条（50 场窗口 = 最多 5 页） */
const page = ref(1)
const PAGE_SIZE = 10

const filteredGames = computed(() => filterMatches(allGames.value, activeFilter.value))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredGames.value.length / PAGE_SIZE)))
const games = computed(() =>
  filteredGames.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)

/** 已到最后一页（按过滤后的命中总数判断） */
const noMoreMatches = computed(() => page.value >= pageCount.value)

/** 跨区(SGP)已拉取的场次窗口起点：每次「收集更多」向后端追加拉取（SGP 无 50 场上限） */
const sgpStartIndex = ref(0)

/** 趋势条：与列表共用同一份过滤（客户端过滤不重拉） */
const trendFiltered = computed(() => filteredGames.value)

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
    try {
      const fetched = await invoke<Game | null>('get_game_by_id', { gameId })
      if (fetched && !allGames.value.some(g => g.gameId === gameId)) {
        allGames.value = [fetched, ...allGames.value]
      }
    } catch (err) {
      console.error('[MatchHistory] focusGame 补拉失败', err)
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
  page.value = Math.floor(idx / PAGE_SIZE) + 1
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

/** 行卡点击：已展开则收起，未展开则就地展开（允许多开） */
function toggleDetail(game: Game) {
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
      sgpStartIndex.value = 50
    } else {
      result = await invoke<MatchHistory>('get_match_history_by_name', {
        name,
        begIndex: 0,
        endIndex: 49
      })
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

// 下一页 / 上一页（纯客户端切片，50 场窗口内翻页；跨区模式下「收集更多」先追加拉取）
const nextPage = () => {
  if (region.value) {
    loadMoreCrossRegion()
    return
  }
  if (!noMoreMatches.value) page.value += 1
}

/** 跨区深翻页：SGP 无 50 场上限，「收集更多」按 startIndex 追加拉取，gameId 去重合并 */
const isRequestingSgpMore = ref(false)
const loadMoreCrossRegion = async () => {
  if (isRequestingSgpMore.value) return
  isRequestingSgpMore.value = true
  try {
    const mh = await getSgpMatchHistoryByName(region.value, name.value, sgpStartIndex.value, 50)
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
  collectCancelRequested.value = false
  isCollectingAll.value = true
  const gen = collectGeneration.value
  try {
    const result = await collectSgpHistoryAll({
      region: region.value,
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
  } catch (err) {
    console.error('[MatchHistory] toggleCollectAll failed', err)
    loadingBar.error()
  } finally {
    isCollectingAll.value = false
  }
}

const prevPage = () => {
  page.value = Math.max(1, page.value - 1)
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
  page.value = Math.floor(idx / PAGE_SIZE) + 1
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
  await getHistoryMatch(name.value)
})

onBeforeUnmount(() => {
  collectGeneration.value++ // 卸载即作废进行中的全量收集
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

.toolbar-more {
  margin-left: auto;
  font-size: var(--font-size-2xs);
  background: var(--glass-bg-low) !important;
  border: 1px solid var(--glass-border) !important;
  color: var(--text-secondary);
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
  aspect-ratio: 1.1 / 1;
  width: 100%;
  max-width: calc(100vh * 1.1);
  max-height: calc(100vw / 1.1);
  margin: auto;
  position: relative;
}

.pagination {
  position: sticky;
  bottom: 0;
  background: var(--bg-base);
  padding: var(--space-8) 0;
  margin-top: var(--space-8);
}

.pagination :deep(.n-button) {
  background: var(--glass-bg-low) !important;
  border: 1px solid var(--glass-border) !important;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    background var(--dur-fast) var(--ease-expo) !important;
}

.pagination :deep(.n-button:hover:not(:disabled)) {
  transform: scale(1.05);
  background: var(--glass-bg-mid) !important;
}

.pagination :deep(.n-button:active:not(:disabled)) {
  transform: scale(0.97);
  transition-duration: var(--dur-instant) !important;
}
</style>
