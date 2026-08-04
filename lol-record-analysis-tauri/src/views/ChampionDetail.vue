<template>
  <main class="detail-page">
    <div v-if="loading" class="loading-stage"><n-spin size="large" /></div>
    <n-result
      v-else-if="error || !detail"
      status="error"
      title="英雄档案加载失败"
      :description="error || '找不到该英雄'"
    >
      <template #footer
        ><n-button @click="router.push(libraryPath)">返回英雄资料库</n-button></template
      >
    </n-result>

    <template v-else>
      <header class="hero-archive">
        <img :src="detail.splashUrl" :alt="detail.name" />
        <div class="hero-shade" />
        <div class="hero-grid" />
        <button type="button" class="back-link" @click="router.push(libraryPath)">
          ← 返回资料库
        </button>
        <div class="hero-copy">
          <span>CHAMPION DOSSIER · {{ detail.alias }}</span>
          <h1>{{ detail.name }}</h1>
          <strong>{{ detail.title }}</strong>
          <p>{{ detail.shortBio }}</p>
          <div class="hero-tags">
            <i v-for="role in detail.roles" :key="role">{{ role }}</i>
            <i v-for="lane in detail.lanes" :key="lane" class="lane">{{ laneLabel(lane) }}</i>
            <i>难度 {{ detail.difficulty }}/3</i>
          </div>
        </div>
        <div class="hero-version">
          <span>DATA PATCH</span>
          <strong>{{ collection?.dataPatch ?? '—' }}</strong>
          <small>公共游戏资料 · 无需客户端</small>
        </div>
      </header>

      <nav class="section-index" aria-label="英雄档案章节">
        <a href="#stats"><b>01</b> 等级数值</a>
        <a href="#abilities"><b>02</b> 技能说明</a>
        <a href="#changes"><b>03</b> 近期改动</a>
        <a href="#matchups"><b>04</b> 对位数据</a>
      </nav>

      <div class="detail-layout">
        <section id="stats" class="archive-section">
          <div class="section-heading">
            <span>01 · STAT WORKBENCH</span>
            <div>
              <h2>等级成长工作台</h2>
              <p>拖动等级，查看基础属性按游戏成长曲线变化。</p>
            </div>
          </div>
          <ChampionStatWorkbench v-model="championLevel" :stats="detail.stats" />
        </section>

        <section id="abilities" class="archive-section">
          <div class="section-heading">
            <span>02 · ABILITY ARCHIVE</span>
            <div>
              <h2>技能与加点数值</h2>
              <p>
                英雄等级和技能等级分开显示；点击技能等级查看冷却、消耗、范围与说明中的分级数值。
              </p>
            </div>
          </div>
          <AbilityArchive :abilities="detail.abilities" />
        </section>

        <section id="changes" class="archive-section">
          <div class="section-heading">
            <span>03 · PATCH TRACE</span>
            <div>
              <h2>近期改动轨迹</h2>
              <p>当前先收录现行国服公告；后续版本会持续累积为历史时间线。</p>
            </div>
          </div>
          <div v-if="currentChange" class="change-timeline" :class="currentChange.direction">
            <div class="timeline-date">
              <strong>{{ collection?.patch?.label }}</strong>
              <span>{{ collection?.patch?.publishedAt }}</span>
            </div>
            <div class="timeline-body">
              <span>{{ directionLabel(currentChange.direction) }}</span>
              <p v-for="line in currentChange.lines" :key="line">{{ line }}</p>
              <button type="button" @click="openPatchSource">查看官方公告 →</button>
            </div>
          </div>
          <div v-else class="empty-trace">当前收录版本没有该英雄的平衡改动。</div>
          <p class="history-note">
            历史收录从本功能上线后的版本开始；旧版本官方公告回填后会在这里自动出现。
          </p>
        </section>

        <section id="matchups" class="archive-section">
          <div class="section-heading">
            <span>04 · MATCHUP MATRIX</span>
            <div>
              <h2>全球服对位矩阵</h2>
              <p>数据按版本、段位和分路拆分；头像可以直接进入对方英雄档案。</p>
            </div>
          </div>
          <MatchupExplorer
            :snapshot="matchups"
            :champions="collection?.champions ?? []"
            :loading="loadingMatchups"
            @select-opponent="openOpponent"
            @update:tier="setTier"
            @update:lane="setLane"
          />
        </section>
      </div>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NResult, NSpin } from 'naive-ui'
import { openUrl } from '@tauri-apps/plugin-opener'
import AbilityArchive from '@renderer/components/champions/detail/AbilityArchive.vue'
import ChampionStatWorkbench from '@renderer/components/champions/detail/ChampionStatWorkbench.vue'
import MatchupExplorer from '@renderer/components/champions/detail/MatchupExplorer.vue'
import {
  getChampionCollection,
  getChampionDetail,
  getChampionMatchups
} from '@renderer/services/championCollection'
import type {
  ChampionCollection,
  ChampionDetail,
  ChampionLane,
  ChangeDirection,
  MatchupSnapshot,
  MatchupTier
} from '@renderer/types/domain/championCollection'

const props = withDefaults(defineProps<{ demo?: boolean; championId?: number }>(), { demo: false })
const route = useRoute()
const router = useRouter()
const detail = ref<ChampionDetail | null>(null)
const collection = ref<ChampionCollection | null>(null)
const matchups = ref<MatchupSnapshot | null>(null)
const championLevel = ref(1)
const tier = ref<MatchupTier>('emerald_plus')
const lane = ref<ChampionLane>('middle')
const loading = ref(false)
const loadingMatchups = ref(false)
const error = ref('')

const id = computed(() => Number(props.championId ?? route.params.championId))
const libraryPath = computed(() => (props.demo ? '/Champions/Demo' : '/Champions'))
const currentChange = computed(() =>
  collection.value?.patch?.changes.find(change => change.championId === id.value)
)

function laneLabel(value: ChampionLane) {
  return { top: '上路', jungle: '打野', middle: '中路', bottom: '下路', support: '辅助' }[value]
}

function directionLabel(value: ChangeDirection) {
  return { buff: '增强', nerf: '削弱', adjusted: '调整' }[value]
}

async function loadDetail() {
  loading.value = true
  error.value = ''
  matchups.value = null
  try {
    if (!Number.isFinite(id.value) || id.value <= 0) throw new Error('无效的英雄编号')
    if (props.demo && import.meta.env.DEV) {
      const demoData = await import('@renderer/dev/championCollectionDemo')
      detail.value = demoData.championDetailDemo(id.value)
      collection.value = demoData.championCollectionDemo
    } else {
      ;[detail.value, collection.value] = await Promise.all([
        getChampionDetail(id.value),
        getChampionCollection()
      ])
    }
    const routeLane = route.query.lane
    lane.value =
      typeof routeLane === 'string' && detail.value.lanes.includes(routeLane as ChampionLane)
        ? (routeLane as ChampionLane)
        : (detail.value.lanes[0] ?? 'middle')
    await loadMatchups()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

async function loadMatchups() {
  if (!detail.value) return
  loadingMatchups.value = true
  try {
    if (props.demo && import.meta.env.DEV) {
      const { matchupDemo } = await import('@renderer/dev/championCollectionDemo')
      matchups.value = matchupDemo(id.value, tier.value, lane.value)
    } else {
      matchups.value = await getChampionMatchups(id.value, tier.value, lane.value)
    }
  } catch {
    matchups.value = null
  } finally {
    loadingMatchups.value = false
  }
}

function setTier(value: MatchupTier) {
  tier.value = value
  void loadMatchups()
}
function setLane(value: ChampionLane) {
  lane.value = value
  void router.replace({ query: { ...route.query, lane: value } })
  void loadMatchups()
}
function openOpponent(opponentId: number) {
  void router.push({
    path: props.demo ? `/Champions/Demo/${opponentId}` : `/Champions/${opponentId}`,
    query: { lane: lane.value }
  })
}
function openPatchSource() {
  const url = collection.value?.patch?.sourceUrl
  if (!url) return
  if ('__TAURI_INTERNALS__' in window) void openUrl(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

watch(id, loadDetail)
onMounted(loadDetail)
</script>

<style scoped>
.detail-page {
  --tactics-gold: #c9a85f;
  min-height: 100%;
  padding-bottom: 60px;
  background: var(--bg-base);
  scroll-behavior: smooth;
}
.loading-stage {
  display: grid;
  min-height: 75vh;
  place-items: center;
}
.hero-archive {
  position: relative;
  min-height: clamp(390px, 49vh, 560px);
  overflow: hidden;
  isolation: isolate;
}
.hero-archive > img {
  position: absolute;
  inset: 0;
  z-index: -3;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 72% 22%;
  filter: saturate(0.82) contrast(1.04);
}
.hero-shade {
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    linear-gradient(
      90deg,
      rgba(7, 9, 12, 0.98) 4%,
      rgba(7, 9, 12, 0.82) 40%,
      rgba(7, 9, 12, 0.18) 75%
    ),
    linear-gradient(0deg, var(--bg-base), transparent 42%);
}
.hero-grid {
  position: absolute;
  inset: 0;
  z-index: -1;
  opacity: 0.22;
  background: linear-gradient(90deg, rgba(201, 168, 95, 0.35) 1px, transparent 1px) 0 0 / 72px 72px;
  mask-image: linear-gradient(90deg, black, transparent 68%);
}
.back-link {
  position: absolute;
  top: 24px;
  left: clamp(22px, 4vw, 64px);
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
}
.hero-copy {
  position: absolute;
  left: clamp(22px, 5vw, 78px);
  bottom: 52px;
  width: min(620px, 66vw);
}
.hero-copy > span,
.hero-version span {
  color: var(--tactics-gold);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.2em;
}
h1 {
  margin: 5px 0 0;
  color: #f4f0e6;
  font-family: 'Noto Serif SC', 'Microsoft YaHei', serif;
  font-size: clamp(48px, 7vw, 88px);
  font-weight: 600;
  letter-spacing: -0.06em;
  line-height: 1;
}
.hero-copy > strong {
  display: block;
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 18px;
  font-weight: 450;
  letter-spacing: 0.08em;
}
.hero-copy p {
  max-width: 560px;
  margin: 18px 0 14px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 13px;
  line-height: 1.75;
}
.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hero-tags i {
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  font-style: normal;
  text-transform: uppercase;
}
.hero-tags i.lane {
  border-color: rgba(201, 168, 95, 0.38);
  color: #d7bd82;
}
.hero-version {
  position: absolute;
  right: clamp(22px, 4vw, 64px);
  bottom: 54px;
  display: grid;
  min-width: 140px;
  padding: 13px 16px;
  border-left: 1px solid rgba(201, 168, 95, 0.7);
  background: rgba(5, 7, 9, 0.46);
  backdrop-filter: blur(10px);
}
.hero-version strong {
  color: #fff;
  font-size: 22px;
}
.hero-version small {
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
}
.section-index {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: center;
  overflow-x: auto;
  border-block: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-base) 91%, transparent);
  backdrop-filter: blur(16px);
}
.section-index a {
  flex: 0 0 auto;
  padding: 13px 22px;
  color: var(--text-tertiary);
  font-size: 11px;
  text-decoration: none;
}
.section-index b {
  margin-right: 7px;
  color: var(--tactics-gold);
  font-family: ui-monospace, monospace;
}
.detail-layout {
  width: min(1280px, calc(100% - 40px));
  margin: 0 auto;
}
.archive-section {
  padding: 54px 0 10px;
  scroll-margin-top: 48px;
}
.section-heading {
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 24px;
  margin-bottom: 22px;
}
.section-heading > span {
  padding-top: 6px;
  color: var(--tactics-gold);
  font:
    10px ui-monospace,
    monospace;
  letter-spacing: 0.13em;
}
.section-heading h2 {
  margin: 0 0 4px;
  color: var(--text-primary);
  font-size: 24px;
}
.section-heading p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
}
.change-timeline {
  display: grid;
  grid-template-columns: 170px 1fr;
  gap: 24px;
  padding: 20px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}
.change-timeline.buff {
  border-left: 3px solid var(--semantic-win);
}
.change-timeline.nerf {
  border-left: 3px solid var(--semantic-loss);
}
.change-timeline.adjusted {
  border-left: 3px solid var(--semantic-warn);
}
.timeline-date {
  display: grid;
  align-content: start;
  gap: 4px;
}
.timeline-date strong {
  color: var(--text-primary);
}
.timeline-date span {
  color: var(--text-disabled);
  font-size: 11px;
}
.timeline-body > span {
  color: var(--tactics-gold);
  font-size: 10px;
  letter-spacing: 0.14em;
}
.timeline-body p {
  margin: 10px 0 0;
  color: var(--text-secondary);
}
.timeline-body button {
  margin-top: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--tactics-gold);
  cursor: pointer;
}
.empty-trace {
  padding: 26px;
  border: 1px dashed var(--border-subtle);
  color: var(--text-tertiary);
}
.history-note {
  color: var(--text-disabled);
  font-size: 10px;
}
@media (max-width: 760px) {
  .hero-copy {
    width: calc(100% - 44px);
  }
  .hero-version {
    display: none;
  }
  .section-heading,
  .change-timeline {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
