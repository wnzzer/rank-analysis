<template>
  <main class="library-page">
    <div v-if="demo" class="demo-banner">
      <span>演示模式</span>
      页面使用内置样例验证交互，不代表当前真实版本或账号数据。
    </div>

    <header class="archive-header">
      <div class="header-copy">
        <span class="eyebrow">TACTICAL ARCHIVE · 游戏资料库</span>
        <h1>英雄战术档案</h1>
        <p>不登录客户端也能查英雄、技能、成长数值、版本变化与全球服对位趋势。</p>
      </div>
      <div class="header-actions">
        <div class="snapshot-mark">
          <span>DATA PATCH</span>
          <strong>{{ collection?.dataPatch || '—' }}</strong>
          <small>{{
            collection?.generatedAt ? `快照 ${collection.generatedAt.slice(0, 10)}` : '读取中'
          }}</small>
        </div>
        <button type="button" class="chroma-link" @click="openChromas">
          <span>账号功能</span>
          我的炫彩 <b>→</b>
        </button>
      </div>
    </header>

    <section class="library-shell">
      <div class="filter-deck">
        <div class="filter-heading">
          <div>
            <span>MAP COORDINATE</span>
            <strong>按常用分路定位</strong>
          </div>
          <p>分路来自当前版本统计，不使用“战士 / 法师”等职业标签代替。</p>
        </div>
        <LaneFilterBar v-model="laneFilter" />

        <div class="search-row">
          <n-input
            v-model:value="query"
            clearable
            size="large"
            placeholder="搜索英雄名、称号或英文名"
          />
          <div class="change-chips" aria-label="按版本改动筛选">
            <button
              v-for="filter in directionFilters"
              :key="filter.value"
              type="button"
              :class="[filter.value, { active: directionFilter === filter.value }]"
              :aria-pressed="directionFilter === filter.value"
              @click="directionFilter = filter.value"
            >
              <i />{{ filter.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="loadingCollection" class="center-state"><n-spin size="large" /></div>
      <n-result
        v-else-if="collectionError"
        status="error"
        title="英雄资料快照加载失败"
        :description="collectionError"
      >
        <template #footer><n-button @click="loadCollection">重新加载</n-button></template>
      </n-result>

      <template v-else-if="collection">
        <div class="status-rail">
          <div class="result-count">
            <strong>{{ visibleChampions.length }}</strong>
            <span>位英雄符合当前坐标</span>
          </div>
          <div class="patch-status">
            <span class="status-dot" />
            <span>国服改动</span>
            <strong>{{ collection.patch?.label ?? '暂无公告' }}</strong>
            <small v-if="collection.patch">{{ collection.patch.publishedAt }}</small>
          </div>
          <div class="legend">
            <span class="buff"><i />增强</span>
            <span class="adjusted"><i />调整</span>
            <span class="nerf"><i />削弱</span>
          </div>
        </div>

        <div v-if="collection.patch && !collection.patch.isFresh" class="stale-warning">
          当前国服公告已超过 21 天；为避免误导，列表不会把旧角标当作现行改动。
        </div>

        <div class="champion-grid">
          <ChampionCard
            v-for="champion in visibleChampions"
            :key="champion.id"
            :champion="champion"
            :change="changeMap.get(champion.id)"
            @select="openChampion(champion.id)"
            @show-change="showChange(champion, $event)"
          />
        </div>
        <n-empty v-if="!visibleChampions.length" description="没有找到符合条件的英雄" />
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
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NInput, NResult, NSpin } from 'naive-ui'
import ChampionCard from '@renderer/components/champions/ChampionCard.vue'
import ChampionChangeDrawer from '@renderer/components/champions/ChampionChangeDrawer.vue'
import LaneFilterBar from '@renderer/components/champions/library/LaneFilterBar.vue'
import {
  createChangeMap,
  filterAndSortChampions,
  type DirectionFilter
} from '@renderer/components/champions/championCollection'
import { getChampionCollection } from '@renderer/services/championCollection'
import type {
  ChampionCollection,
  ChampionCollectionItem,
  ChampionLane,
  PatchChangeItem
} from '@renderer/types/domain/championCollection'

const props = withDefaults(defineProps<{ demo?: boolean }>(), { demo: false })
const router = useRouter()

const query = ref('')
const laneFilter = ref<ChampionLane | 'all'>('all')
const directionFilter = ref<DirectionFilter>('all')
const collection = ref<ChampionCollection | null>(null)
const loadingCollection = ref(false)
const collectionError = ref('')
const drawerOpen = ref(false)
const selectedChampion = ref<ChampionCollectionItem | null>(null)
const selectedChange = ref<PatchChangeItem | null>(null)

const directionFilters: Array<{ value: DirectionFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'buff', label: '增强' },
  { value: 'adjusted', label: '调整' },
  { value: 'unchanged', label: '未改动' },
  { value: 'nerf', label: '削弱' }
]

const changeMap = computed(() =>
  createChangeMap(collection.value?.patch?.isFresh ? collection.value.patch.changes : [])
)
const visibleChampions = computed(() =>
  filterAndSortChampions(
    collection.value?.champions ?? [],
    changeMap.value,
    query.value,
    directionFilter.value,
    laneFilter.value
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

function openChampion(championId: number) {
  void router.push({
    path: props.demo ? `/Champions/Demo/${championId}` : `/Champions/${championId}`,
    query: laneFilter.value === 'all' ? {} : { lane: laneFilter.value }
  })
}

function openChromas() {
  void router.push(props.demo ? '/Champions/Demo/Chromas' : '/Champions/Chromas')
}

function showChange(champion: ChampionCollectionItem, change: PatchChangeItem) {
  selectedChampion.value = champion
  selectedChange.value = change
  drawerOpen.value = true
}

onMounted(loadCollection)
</script>

<style scoped>
.library-page {
  --tactics-gold: #c9a85f;
  --tactics-line: color-mix(in srgb, var(--tactics-gold) 22%, var(--border-subtle));
  min-height: 100%;
  padding: clamp(20px, 2.7vw, 38px);
  background:
    linear-gradient(
        90deg,
        color-mix(in srgb, var(--tactics-gold) 3%, transparent) 1px,
        transparent 1px
      )
      0 0 / 56px 56px,
    radial-gradient(
      circle at 76% -10%,
      color-mix(in srgb, var(--tactics-gold) 13%, transparent),
      transparent 34%
    ),
    var(--bg-base);
}

.demo-banner {
  display: flex;
  gap: 10px;
  max-width: 1500px;
  margin: 0 auto 14px;
  padding: 8px 12px;
  border-left: 2px solid var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 8%, var(--bg-surface));
  color: var(--text-tertiary);
  font-size: 12px;
}
.demo-banner span {
  color: var(--semantic-warn);
  font-weight: 700;
}

.archive-header,
.library-shell {
  max-width: 1500px;
  margin-inline: auto;
}
.archive-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 24px;
}
.eyebrow {
  color: var(--tactics-gold);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.2em;
}
h1 {
  margin: 6px 0 5px;
  color: var(--text-primary);
  font-family: 'Noto Serif SC', 'Microsoft YaHei', serif;
  font-size: clamp(30px, 4vw, 48px);
  font-weight: 650;
  letter-spacing: -0.04em;
}
.header-copy p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 14px;
}
.header-actions {
  display: flex;
  align-items: stretch;
  gap: 10px;
}
.snapshot-mark {
  display: grid;
  min-width: 132px;
  padding: 10px 14px;
  border: 1px solid var(--tactics-line);
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
}
.snapshot-mark span {
  color: var(--text-disabled);
  font-size: 9px;
  letter-spacing: 0.16em;
}
.snapshot-mark strong {
  color: var(--tactics-gold);
  font-size: 17px;
}
.snapshot-mark small {
  color: var(--text-disabled);
  font-size: 10px;
}
.chroma-link {
  min-width: 140px;
  padding: 10px 14px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}
.chroma-link span {
  display: block;
  margin-bottom: 5px;
  color: var(--text-disabled);
  font-size: 9px;
  letter-spacing: 0.14em;
}
.chroma-link b {
  float: right;
  color: var(--tactics-gold);
}

.filter-deck {
  overflow: hidden;
  border: 1px solid var(--tactics-line);
  background: color-mix(in srgb, var(--bg-surface) 94%, transparent);
  box-shadow: 0 22px 70px rgb(0 0 0 / 18%);
}
.filter-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding: 15px 18px 10px;
  border-bottom: 1px solid var(--border-subtle);
}
.filter-heading div {
  display: grid;
  gap: 2px;
}
.filter-heading span {
  color: var(--tactics-gold);
  font-size: 9px;
  letter-spacing: 0.18em;
}
.filter-heading strong {
  color: var(--text-primary);
  font-size: 13px;
}
.filter-heading p {
  margin: 0;
  color: var(--text-disabled);
  font-size: 11px;
}
.search-row {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 18px 16px;
}
.change-chips {
  display: flex;
  gap: 4px;
}
.change-chips button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 11px;
}
.change-chips button i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-disabled);
}
.change-chips button.active {
  border-color: var(--tactics-line);
  background: color-mix(in srgb, var(--tactics-gold) 8%, transparent);
  color: var(--text-primary);
}
.change-chips .buff i {
  background: var(--semantic-win);
}
.change-chips .adjusted i {
  background: var(--semantic-warn);
}
.change-chips .nerf i {
  background: var(--semantic-loss);
}

.status-rail {
  display: flex;
  align-items: center;
  gap: 22px;
  margin: 16px 1px 10px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.result-count {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.result-count strong {
  color: var(--text-primary);
  font-family: ui-monospace, monospace;
  font-size: 20px;
}
.patch-status {
  display: flex;
  align-items: center;
  gap: 7px;
}
.patch-status strong {
  color: var(--text-secondary);
}
.patch-status small {
  color: var(--text-disabled);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--semantic-win);
  box-shadow: 0 0 9px var(--semantic-win);
}
.legend {
  display: flex;
  gap: 12px;
  margin-left: auto;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.legend .buff i {
  background: var(--semantic-win);
}
.legend .adjusted i {
  background: var(--semantic-warn);
}
.legend .nerf i {
  background: var(--semantic-loss);
}
.champion-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
  gap: 12px;
  padding-bottom: 30px;
}
.champion-grid :deep(.champion-card) {
  content-visibility: auto;
  contain-intrinsic-size: 170px;
  border-radius: 2px;
}
.center-state {
  display: grid;
  min-height: 360px;
  place-items: center;
}
.stale-warning {
  margin: 10px 0;
  padding: 9px 12px;
  border-left: 2px solid var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 8%, transparent);
  color: var(--semantic-warn);
  font-size: 11px;
}

@media (max-width: 850px) {
  .archive-header,
  .filter-heading {
    align-items: stretch;
    flex-direction: column;
  }
  .search-row {
    grid-template-columns: 1fr;
  }
  .change-chips {
    overflow-x: auto;
  }
  .change-chips button {
    flex: 0 0 auto;
  }
}
</style>
