<template>
  <div class="ratio-container">
    <n-flex vertical class="content-wrapper match-history-wrap">
      <n-flex class="match-history-toolbar" align="center" :size="8">
        <n-select
          v-model:value="filterQueueId"
          placeholder="按模式筛选"
          :options="modeOptions"
          size="small"
          class="filter-select filter-mode"
          @update:value="handleUpdateValue"
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
          @update:value="handleUpdateValue"
        />
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button quaternary circle size="small" class="toolbar-reset" @click="resetFilter">
              <n-icon><RepeatOutline /></n-icon>
            </n-button>
          </template>
          复位
        </n-tooltip>
      </n-flex>

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
          class="list-item"
        >
          <RecordCard :record-type="true" :games="game" @open-detail="openDetail(game)" />
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
            <span>{{ page }}</span>
          </template>
          <template #next>
            <n-button
              size="tiny"
              @click="nextPage"
              :disabled="page == 5 || isRequestingMatchHostory || noMoreMatches"
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
import { ArrowBack, ArrowForward, RepeatOutline } from '@vicons/ionicons5'
import { computed, onMounted, provide, ref, watch } from 'vue'
import { NEmpty, NButton, useLoadingBar } from 'naive-ui'
import { useRoute } from 'vue-router'
import { renderSingleSelectTag, renderLabel, filterChampionFunc } from '../composition'
import { modeOptions, initModeOptions } from './composition'
import { invoke } from '@tauri-apps/api/core'
import { championOption } from '../type'
import type { Game, MatchHistory } from './match'
import { openMatchDetailWindow } from './detailWindow'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { recordAssetsKey } from '@renderer/composables/recordAssetsKey'

/**
 * 父级批量加载：一次性收集当前页所有战绩的 item/spell/perk ID 去重后下发 IPC
 * 子 RecordCard 通过 inject 共享，跳过自身 preload
 */
const recordAssets = useRecordAssets()
provide(recordAssetsKey, recordAssets)

function collectAssetIds(games: Game[] | undefined) {
  const items = new Set<number>()
  const spells = new Set<number>()
  const perks = new Set<number>()
  for (const g of games ?? []) {
    const s = g.participants[0]?.stats
    if (!s) continue
    ;[s.item0, s.item1, s.item2, s.item3, s.item4, s.item5, s.item6].forEach(id => {
      if (id > 0) items.add(id)
    })
    ;[g.participants[0].spell1Id, g.participants[0].spell2Id].forEach(id => {
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
  return {
    items: [...items],
    spells: [...spells],
    perks: [...perks]
  }
}

const filterQueueId = ref(0)
const filterChampionId = ref(-1)
const championOptions = ref<championOption[]>([])

const resetFilter = () => {
  pageHistory.value = []
  filterQueueId.value = 0
  filterChampionId.value = -1
  handleUpdateValue()
}
const handleUpdateValue = () => {
  page.value = 1
  if (filterChampionId.value > 0 || filterQueueId.value > 0) {
    getHistoryMatch(name.value, 0, 49)
  } else {
    getHistoryMatch(name.value, 0, 9)
  }
}

const matchHistory = ref<MatchHistory>()
const loadingBar = useLoadingBar()
const isRequestingMatchHostory = ref(false)
const loadError = ref(false)
const page = ref(1)
const pageHistory = ref<{ begIndex: number; endIndex: number }[]>([])

let curBegIndex = 0
let curEndIndex = 0

const route = useRoute()
const name = computed(() => (route.query.name as string) ?? '')
/** 跨区查询目标大区 platformId（空 = 当前区，走本地 LCU；非空走 SGP 跨区） */
const region = computed(() => (route.query.region as string) ?? '')

/** 当前页对局列表（响应式扁平化，便于空态判断） */
const games = computed<Game[]>(() => matchHistory.value?.games?.games ?? [])

/** 是否启用了任何筛选条件（用于区分"无数据"与"筛选无结果"） */
const hasFilter = computed(() => filterChampionId.value > 0 || filterQueueId.value > 0)

/**
 * 已到最后一页：无筛选时每页固定请求 10 条，不满 10 条即无下页；
 * 筛选分页按命中数续推，只能以"当前页为空"兜底判断。
 */
const noMoreMatches = computed(() =>
  hasFilter.value ? games.value.length === 0 : games.value.length < 10
)

async function openDetail(game: Game) {
  await openMatchDetailWindow(game)
}

// 获取历史记录
const getHistoryMatch = async (name: string, begIndex: number, endIndex: number) => {
  loadingBar.start()
  isRequestingMatchHostory.value = true
  loadError.value = false
  try {
    if (region.value) {
      // 跨区：走 SGP（按名字#TAG）。暂不支持英雄/队列筛选，故忽略筛选条件。
      matchHistory.value = await invoke('get_sgp_match_history_by_name', {
        region: region.value,
        name,
        begIndex,
        count: endIndex - begIndex + 1
      })
    } else if (filterChampionId.value > 0 || filterQueueId.value > 0) {
      matchHistory.value = await invoke('get_filter_match_history_by_name', {
        name,
        begIndex,
        endIndex,
        filterQueueId: filterQueueId.value,
        filterChampionId: filterChampionId.value
      })
    } else {
      matchHistory.value = await invoke('get_match_history_by_name', {
        name,
        begIndex,
        endIndex
      })
    }
    if (matchHistory.value) {
      curBegIndex = matchHistory.value.begIndex
      curEndIndex = matchHistory.value.endIndex
    }
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
  loadError.value = false
  await getHistoryMatch(name.value, curBegIndex, curEndIndex)
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

// 下一页
const nextPage = async () => {
  let begIndex = 0
  let endIndex = 0
  pageHistory.value.push({ begIndex: curBegIndex, endIndex: curEndIndex })

  if (filterQueueId.value > 0 || filterChampionId.value > 0) {
    begIndex = curEndIndex + 1
    endIndex = 49
  } else {
    begIndex = page.value * 10
    endIndex = begIndex + 9
  }

  await getHistoryMatch(name.value, begIndex, endIndex)
  page.value++
}

// 上一页
const prevPage = async () => {
  const lastPage = pageHistory.value.pop()

  if (!lastPage) {
    throw new Error('无上一页数据')
  }
  await getHistoryMatch(name.value, lastPage.begIndex, lastPage.endIndex)
  page.value = Math.max(1, page.value - 1)
}

onMounted(async () => {
  await initModeOptions()
  championOptions.value = await invoke<championOption[]>('get_champion_options')
  await getHistoryMatch(name.value, 0, 9)
})
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

.list-item {
  /* TransitionGroup child; stagger via --stagger-i */
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

.filter-select.filter-mode {
  width: 100px;
  margin-left: var(--space-8);
}

.filter-select.filter-champion {
  width: 170px;
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
