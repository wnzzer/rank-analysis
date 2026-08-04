<template>
  <main class="champions-page">
    <div v-if="demo" class="demo-banner">
      <span>演示数据</span>
      仅用于无客户端时预览界面，不代表你的账号库存或当前真实版本。
    </div>

    <header class="page-header">
      <div>
        <span class="eyebrow">COLLECTION</span>
        <h1>英雄藏品</h1>
        <p>浏览全部英雄、查看当前版本调整，并找回账号拥有的炫彩。</p>
      </div>
      <div class="mode-switch" aria-label="藏品视图">
        <button
          type="button"
          :class="{ active: activeView === 'champions' }"
          :aria-pressed="activeView === 'champions'"
          @click="activeView = 'champions'"
        >
          英雄大全
        </button>
        <button
          type="button"
          :class="{ active: activeView === 'chromas' }"
          :aria-pressed="activeView === 'chromas'"
          @click="openChromas"
        >
          我的炫彩
        </button>
      </div>
    </header>

    <section v-if="activeView === 'champions'" class="collection-section">
      <div class="toolbar panel-glass">
        <div class="patch-summary">
          <span class="patch-kicker">国服版本改动</span>
          <strong>{{ collection?.patch?.label ?? '暂无可用公告' }}</strong>
          <span v-if="collection?.patch">{{ collection.patch.publishedAt }}</span>
          <span v-if="collection && collection.source !== 'lcu'" class="offline-pill">
            未连接客户端 · 在线英雄资料
          </span>
        </div>
        <div class="toolbar-controls">
          <n-input
            v-model:value="query"
            clearable
            size="small"
            placeholder="搜索英雄名、称号或英文名"
          />
          <select v-model="directionFilter" class="direction-select" aria-label="按改动筛选">
            <option value="all">全部改动</option>
            <option value="buff">增强</option>
            <option value="adjusted">调整</option>
            <option value="unchanged">未改动</option>
            <option value="nerf">削弱</option>
          </select>
        </div>
      </div>

      <div v-if="loadingCollection" class="center-state"><n-spin size="large" /></div>
      <n-result
        v-else-if="collectionError"
        status="error"
        title="英雄资料加载失败"
        :description="collectionError"
      >
        <template #footer><n-button @click="loadCollection">重新加载</n-button></template>
      </n-result>
      <template v-else-if="collection">
        <div v-if="collection.patch && !collection.patch.isFresh" class="stale-warning">
          当前国服公告已超过 21 天，角标可能不是现行版本，请以官方公告为准。
        </div>
        <div class="result-line">
          <span>{{ visibleChampions.length }} 位英雄</span>
          <span class="legend"
            ><i class="buff" />增强 <i class="adjusted" />调整 <i class="nerf" />削弱</span
          >
        </div>
        <div class="champion-grid">
          <ChampionCard
            v-for="champion in visibleChampions"
            :key="champion.id"
            :champion="champion"
            :change="changeMap.get(champion.id)"
            @show-change="showChange(champion, $event)"
          />
        </div>
        <n-empty v-if="!visibleChampions.length" description="没有找到符合条件的英雄" />
      </template>
    </section>

    <section v-else class="collection-section chroma-section">
      <div class="chroma-heading panel-glass">
        <div>
          <span class="patch-kicker">只读账号藏品</span>
          <strong>{{ chromaCollection?.summonerName ?? '我的炫彩' }}</strong>
          <p>从当前登录的英雄联盟客户端读取，不会修改客户端或账号内容。</p>
        </div>
        <span v-if="chromaCollection" class="chroma-count">
          {{ chromaCollection.chromas.length }} 个炫彩
        </span>
      </div>

      <div v-if="loadingChromas" class="center-state"><n-spin size="large" /></div>
      <n-result
        v-else-if="chromaError"
        status="warning"
        title="暂时无法读取炫彩"
        :description="chromaError"
      >
        <template #footer>
          <n-button @click="loadChromas">连接客户端后重试</n-button>
        </template>
      </n-result>
      <n-empty
        v-else-if="chromaCollection && !chromaCollection.chromas.length"
        description="客户端返回成功，但当前账号没有可显示的炫彩"
      />
      <template v-else-if="chromaCollection">
        <div v-if="chromaCollection.warning" class="stale-warning">
          {{ chromaCollection.warning }}
        </div>
        <OwnedChromaGrid :chromas="chromaCollection.chromas" />
      </template>
    </section>

    <ChampionChangeDrawer
      v-model:show="drawerOpen"
      :champion="selectedChampion"
      :change="selectedChange"
      :patch-label="collection?.patch?.label ?? ''"
      :published-at="collection?.patch?.publishedAt ?? ''"
      :source-url="collection?.patch?.sourceUrl ?? ''"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NEmpty, NInput, NResult, NSpin } from 'naive-ui'
import ChampionCard from '@renderer/components/champions/ChampionCard.vue'
import ChampionChangeDrawer from '@renderer/components/champions/ChampionChangeDrawer.vue'
import OwnedChromaGrid from '@renderer/components/champions/OwnedChromaGrid.vue'
import {
  createChangeMap,
  filterAndSortChampions,
  type DirectionFilter
} from '@renderer/components/champions/championCollection'
import { getChampionCollection, getOwnedChromas } from '@renderer/services/championCollection'
import type {
  ChampionCollection,
  ChampionCollectionItem,
  OwnedChromaCollection,
  PatchChangeItem
} from '@renderer/types/domain/championCollection'

const props = withDefaults(defineProps<{ demo?: boolean }>(), { demo: false })

const activeView = ref<'champions' | 'chromas'>('champions')
const query = ref('')
const directionFilter = ref<DirectionFilter>('all')
const collection = ref<ChampionCollection | null>(null)
const chromaCollection = ref<OwnedChromaCollection | null>(null)
const loadingCollection = ref(false)
const loadingChromas = ref(false)
const collectionError = ref('')
const chromaError = ref('')
const drawerOpen = ref(false)
const selectedChampion = ref<ChampionCollectionItem | null>(null)
const selectedChange = ref<PatchChangeItem | null>(null)

const changeMap = computed(() =>
  createChangeMap(collection.value?.patch?.isFresh ? collection.value.patch.changes : [])
)
const visibleChampions = computed(() =>
  filterAndSortChampions(
    collection.value?.champions ?? [],
    changeMap.value,
    query.value,
    directionFilter.value
  )
)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadCollection() {
  loadingCollection.value = true
  collectionError.value = ''
  try {
    if (props.demo && import.meta.env.DEV) {
      const { championCollectionDemo } = await import('@renderer/dev/championCollectionDemo')
      collection.value = championCollectionDemo
    } else {
      collection.value = await getChampionCollection()
    }
  } catch (error) {
    collectionError.value = errorMessage(error)
  } finally {
    loadingCollection.value = false
  }
}

async function loadChromas() {
  loadingChromas.value = true
  chromaError.value = ''
  try {
    if (props.demo && import.meta.env.DEV) {
      const { ownedChromaDemo } = await import('@renderer/dev/championCollectionDemo')
      chromaCollection.value = ownedChromaDemo
    } else {
      chromaCollection.value = await getOwnedChromas()
    }
  } catch (error) {
    chromaCollection.value = null
    chromaError.value = `${errorMessage(error)}。请确认客户端已启动并完成登录。`
  } finally {
    loadingChromas.value = false
  }
}

function openChromas() {
  activeView.value = 'chromas'
  if (!chromaCollection.value && !loadingChromas.value) void loadChromas()
}

function showChange(champion: ChampionCollectionItem, change: PatchChangeItem) {
  selectedChampion.value = champion
  selectedChange.value = change
  drawerOpen.value = true
}

onMounted(loadCollection)
</script>

<style scoped>
.champions-page {
  min-height: 100%;
  padding: clamp(18px, 2.5vw, 32px);
  background:
    radial-gradient(
      circle at 12% 0%,
      color-mix(in srgb, var(--semantic-win) 8%, transparent),
      transparent 28%
    ),
    var(--bg-base);
}

.demo-banner {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  margin-bottom: var(--space-16);
  padding: var(--space-8) var(--space-12);
  border: 1px solid color-mix(in srgb, var(--semantic-warn) 35%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--semantic-warn) 9%, transparent);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
}

.demo-banner span {
  color: var(--semantic-warn);
  font-weight: var(--font-weight-semibold);
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-24);
  max-width: 1500px;
  margin: 0 auto var(--space-24);
}

.eyebrow,
.patch-kicker {
  color: var(--semantic-win-bright);
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.14em;
}

h1 {
  margin: 4px 0;
  color: var(--text-primary);
  font-size: clamp(25px, 3vw, 34px);
  line-height: 1.15;
}

.page-header p,
.chroma-heading p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-base);
}

.mode-switch {
  display: flex;
  padding: 3px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.mode-switch button {
  padding: 8px 14px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all var(--dur-fast) var(--ease-expo);
}

.mode-switch button.active {
  background: var(--nav-active-bg);
  color: var(--semantic-win-bright);
}

.collection-section {
  max-width: 1500px;
  margin: 0 auto;
}

.panel-glass {
  border: 1px solid var(--border-subtle);
  background: var(--glass-bg-low);
  box-shadow: var(--glass-highlight);
}

.toolbar,
.chroma-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-20);
  padding: var(--space-16);
  border-radius: var(--radius-lg);
}

.patch-summary,
.chroma-heading > div {
  display: flex;
  align-items: baseline;
  gap: var(--space-8);
  min-width: 0;
}

.patch-summary strong,
.chroma-heading strong {
  color: var(--text-primary);
  font-size: var(--font-size-md);
}

.patch-summary > span:not(.patch-kicker):not(.offline-pill) {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.offline-pill {
  padding: 3px 7px;
  border-radius: var(--radius-pill);
  background: var(--glass-bg-high);
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
}

.toolbar-controls {
  display: grid;
  grid-template-columns: minmax(220px, 310px) 110px;
  gap: var(--space-8);
}

.direction-select {
  border: 1px solid var(--border-control);
  border-radius: var(--radius-control);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  padding: 0 var(--space-8);
  outline: none;
}

.direction-select option {
  background: var(--bg-elevated);
}

.result-line {
  display: flex;
  justify-content: space-between;
  margin: var(--space-16) 1px var(--space-10);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.legend {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.legend i {
  width: 7px;
  height: 7px;
  margin-left: var(--space-6);
  border-radius: 50%;
}

.legend .buff {
  background: var(--semantic-win);
}
.legend .adjusted {
  background: var(--semantic-warn);
}
.legend .nerf {
  background: var(--semantic-loss);
}

.champion-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--space-12);
  padding-bottom: var(--space-28);
}

.center-state {
  display: grid;
  min-height: 360px;
  place-items: center;
}

.stale-warning {
  margin-top: var(--space-12);
  padding: var(--space-10) var(--space-12);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--semantic-warn) 10%, transparent);
  color: var(--semantic-warn);
  font-size: var(--font-size-xs);
}

.chroma-heading {
  margin-bottom: var(--space-16);
}

.chroma-heading > div {
  align-items: flex-start;
  flex-direction: column;
  gap: var(--space-4);
}

.chroma-count {
  color: var(--semantic-win-bright);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

@media (max-width: 760px) {
  .page-header,
  .toolbar,
  .chroma-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .mode-switch {
    align-self: flex-start;
  }

  .toolbar-controls {
    grid-template-columns: 1fr;
  }

  .direction-select {
    min-height: 32px;
  }
}
</style>
