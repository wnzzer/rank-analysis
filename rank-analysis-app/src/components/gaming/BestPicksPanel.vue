<template>
  <div v-if="visible" class="best-picks-panel" :class="{ 'panel-error': error }">
    <n-popover trigger="click" :width="460" :show-arrow="false">
      <template #trigger>
        <div class="bp-bar" role="button" tabindex="0">
          <span class="bp-label">{{ barLabel }}</span>
          <span v-if="hasSynergy && teammatePicks.length > 0" class="bp-teammate-avatars">
            <img
              v-for="t in teammatePicks"
              :key="`t-${t.championId}`"
              class="bp-teammate-avatar"
              :class="{ 'bp-teammate-avatar--dim': !isTeammateLit(t.championId) }"
              :src="getChampionUrl(t.championId)"
              :alt="championName(t.championId)"
              :title="
                championName(t.championId) +
                (isTeammateLit(t.championId) ? '（已点亮）' : '（已熄灭，点击点亮）')
              "
              @click.stop="toggleTeammateLit(t.championId)"
            />
          </span>
          <span v-if="enemyPicks.length > 0" class="bp-enemy-avatars">
            <img
              v-for="e in enemyPicks"
              :key="e.championId"
              class="bp-enemy-avatar"
              :src="getChampionUrl(e.championId)"
              :alt="championName(e.championId)"
            />
          </span>
          <span class="bp-arrow-label">{{ barArrowLabel }}</span>
          <span v-if="isLoading" class="bp-loading">分析中…</span>
          <span v-else-if="picks.length > 0" class="bp-pick-avatars">
            <img
              v-for="p in picks.slice(0, 3)"
              :key="p.championId"
              class="bp-pick-avatar"
              :src="getChampionUrl(p.championId)"
              :alt="championName(p.championId)"
              :title="pickTitle(p)"
            />
          </span>
          <span v-else-if="error" class="bp-error-text">OP.GG 数据未就绪</span>
          <span v-else class="bp-empty-text">{{ emptyText }}</span>
          <span class="bp-expand-hint"><ChevronDown class="bp-hint-glyph" /> {{ expandHint }}</span>
        </div>
      </template>
      <div class="bp-panel-content">
        <div class="bp-panel-title">
          {{ titleText }}
          <span class="bp-panel-count">{{ shownPicks.length }}/{{ picks.length }} 个候选</span>
        </div>
        <!-- 当前生效的非默认筛选：chip 回显 + 点击撤销（设计系统 v3 §C2-G7） -->
        <div v-if="activeFilterChips.length > 0" class="bp-chips">
          <button
            v-for="c in activeFilterChips"
            :key="c.key"
            type="button"
            class="bp-chip"
            :title="'点击恢复默认'"
            @click="c.reset"
          >
            {{ c.label }} ×
          </button>
        </div>
        <div class="bp-controls">
          <span class="bp-control-label">位置</span>
          <n-select
            v-model:value="positionFilter"
            :options="PICK_POSITION_OPTIONS"
            size="tiny"
            class="bp-control"
          />
          <span class="bp-control-label">段位</span>
          <n-select
            :value="tier"
            :options="[...TIER_OPTIONS]"
            :loading="tierLoading"
            :disabled="tierLoading"
            size="tiny"
            class="bp-control"
            @update:value="onSwitchTier"
          />
          <span class="bp-control-label">数量</span>
          <n-select
            v-model:value="displayCount"
            :options="COUNT_OPTIONS"
            size="tiny"
            class="bp-control"
            @update:value="onChangeCount"
          />
        </div>
        <div class="bp-filter-row">
          <n-checkbox
            v-model:checked="onlyOwned"
            size="small"
            :disabled="ownedUnavailable"
            class="bp-filter-check"
            >仅已拥有</n-checkbox
          >
          <n-checkbox
            v-model:checked="poolOnly"
            size="small"
            :disabled="!poolUsable"
            class="bp-filter-check"
            >仅英雄池</n-checkbox
          >
          <n-checkbox v-model:checked="coverageFirst" size="small" class="bp-filter-check"
            >优先覆盖</n-checkbox
          >
          <span v-if="poolLoading" class="bp-filter-hint">英雄池统计中…</span>
          <template v-else-if="poolOnly">
            <span class="bp-filter-label">胜率≥</span>
            <n-input-number
              v-model:value="poolMinWinRate"
              :min="0"
              :max="100"
              size="small"
              class="bp-filter-num"
            />
            <span class="bp-filter-label">% 场次≥</span>
            <n-input-number
              v-model:value="poolMinGames"
              :min="1"
              :max="200"
              size="small"
              class="bp-filter-num"
            />
          </template>
          <span v-if="filterHint" class="bp-filter-hint">{{ filterHint }}</span>
        </div>
        <div v-if="allNonPositive" class="bp-none-warning">
          敌方当前阵容下无正面对位优势英雄（以下为相对最不劣）
        </div>
        <n-scrollbar v-if="picks.length > 0" max-height="380px" class="bp-panel-scroll">
          <div v-for="p in shownPicks" :key="p.championId" class="bp-pick-card">
            <img class="bp-pick-card-avatar" :src="getChampionUrl(p.championId)" alt="" />
            <div class="bp-pick-card-main">
              <div class="bp-pick-card-head">
                <span class="bp-pick-card-name">{{ championName(p.championId) }}</span>
                <span class="bp-pick-card-score" :class="scoreClass(p.score)"
                  >分数 {{ scoreText(p.score) }}</span
                >
                <template v-if="hasSynergy">
                  <span
                    class="bp-pick-card-subscore"
                    :class="p.synergyScore > 0 ? 'score-positive' : 'score-zero'"
                    >协同 {{ scoreText(p.synergyScore) }}</span
                  >
                  <span class="bp-pick-card-subscore" :class="subScoreClass(p.counterScore)"
                    >对位 {{ scoreText(p.counterScore) }}</span
                  >
                </template>
              </div>
              <div class="bp-pick-card-bar">
                <span class="bp-pick-card-bar-fill" :style="{ width: scoreBarWidth(p.score) }" />
              </div>
              <div class="bp-pick-card-evidence">
                <template v-for="e in p.synergyEvidences" :key="`syn-${e.teammateChampionId}`">
                  <span class="bp-evidence-line ev-synergy">
                    协同 {{ championName(e.teammateChampionId) }}（{{
                      formatCounterLine(e.winRate, e.play)
                    }}）
                  </span>
                </template>
                <template v-for="e in p.evidences" :key="e.againstChampionId">
                  <span
                    class="bp-evidence-line"
                    :class="e.relation === 'favored' ? 'ev-good' : 'ev-bad'"
                  >
                    {{ e.relation === 'favored' ? '克制' : '被克' }}
                    {{ championName(e.againstChampionId) }}（{{
                      formatCounterLine(e.winRate, e.play)
                    }}）
                  </span>
                </template>
                <span
                  v-if="p.evidences.length === 0 && p.synergyEvidences.length === 0"
                  class="bp-evidence-none"
                >
                  其余对位/协同无 OP.GG 数据
                </span>
              </div>
            </div>
          </div>
        </n-scrollbar>
        <div v-else-if="!error && !isLoading" class="bp-panel-empty">
          {{ emptyText }}
        </div>
        <div class="bp-panel-footer">
          <span>按敌方已锁{{ hasSynergy ? ' + 队友已亮协同' : '' }}计算</span>
          <span v-if="filterStatusLabel" class="bp-filter-status">{{ filterStatusLabel }}</span>
          <span class="bp-panel-source">OP.GG {{ region }} · {{ tier }}</span>
        </div>
      </div>
    </n-popover>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
/**
 * 已亮阵容 → 我方最优推荐条（P2 对位 + P3 协同双维）。
 *
 * 展示条件：敌方锁定 ≥2，或我方队友已亮 ≥1（纯协同场景）。常驻条展示
 * 敌方/队友头像 + Top3 推荐；点击展开 Top5 卡（头像/名字/总分 bar/
 * 协同子分/对位子分/逐条证据）。数据来自 [`useBestPicks`]：反查敌方
 * counters + 命中队友 synergies 融合评分，未知对位/协同记 0 不编造。
 *
 * 候选池细粒度筛选（弹层内控制、配置持久化）：
 * - 「仅已拥有」：`lol-champions/v1/owned-champions-minimal`，排位只能选已拥有
 *   英雄故默认开；LCU 失败时降级为不筛该维度并提示。
 * - 「仅英雄池」：我的最近 50 场战绩聚合（`get_match_history_by_name` +
 *   `aggregateChampionPool`，与 Record 页英雄池同源），胜率/场次门槛可调。
 *
 * 隐藏规则由父组件控制（仅 ranked && ChampSelect 渲染本组件）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NCheckbox, NInputNumber, NPopover, NScrollbar, NSelect } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import {
  formatCounterLine,
  PICK_POSITION_OPTIONS,
  resolvePanelPosition,
  type DualPick,
  type PickPositionFilter
} from '@renderer/features/gaming/services/counterIntel'
import { useBestPicks } from '@renderer/composables/useCounterIntel'
import { getChampionName } from '@renderer/services/ai/champion-names'
import { TIER_OPTIONS, type OpggTier } from '@renderer/services/opgg'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { getOwnedChampionIds } from '@renderer/features/gaming/services/ownedChampions'
import {
  aggregateChampionPool,
  filterChampionPoolByThresholds,
  type ChampionPoolEntry
} from '@renderer/components/record/championPool'
import type { MatchHistory } from '@renderer/types/domain/match'

const props = withDefaults(
  defineProps<{
    /** 敌方已锁英雄 ID（>0 已锁定） */
    enemyIds: number[]
    /** 排除 ban/锁定/intent 后的候选英雄 ID（全量可选池） */
    candidateIds: number[]
    /** OP.GG 段位分段 */
    tier: string
    /** 段位切换中（禁用下拉避免并发切换） */
    tierLoading?: boolean
    /** 区域 */
    region?: string
    /** 我方已亮队友英雄 ID（含 intent/picking/locked；空 = 纯对位推荐） */
    teammateIds?: number[]
    /** 我方队友本局分路（championId → LCU 命名，如 { 103: 'top' }；空 = 回退英雄主分路） */
    teammatePositions?: Record<number, string>
    /** 我本局分路（LCU 命名，大小写均可；空 = 不过滤候选位置） */
    myPosition?: string
    /** 我自己的召唤师名（格式 名称#标签；空 = 英雄池筛选不可用） */
    mySummonerName?: string
  }>(),
  {
    tierLoading: false,
    region: 'global',
    teammateIds: () => [],
    teammatePositions: () => ({}),
    myPosition: '',
    mySummonerName: ''
  }
)

const emit = defineEmits<{ 'switch-tier': [next: OpggTier] }>()

const { getChampionUrl } = useAssetUrl()

/** 显示数量选项：固定档位 + 全部（默认 5，与历史 top5 一致） */
const COUNT_OPTIONS: Array<{ label: string; value: number | 'all' }> = [
  { label: '5 个', value: 5 },
  { label: '10 个', value: 10 },
  { label: '20 个', value: 20 },
  { label: '全部', value: 'all' }
]

const COUNT_CONFIG_KEY = 'bestPicksCount'
const COUNT_VALID: readonly number[] = [5, 10, 20]

/** 面板内展示的推荐数量（'all' = 不限） */
const displayCount = ref<number | 'all'>(5)

/** 位置筛选：默认跟随我本局分路，可选全位置或指定分路 */
const positionFilter = ref<PickPositionFilter>('follow')

/** 实际生效的候选位置（OP.GG 命名；空串 = 不过滤） */
const effectivePosition = computed(() =>
  resolvePanelPosition(positionFilter.value, props.myPosition)
)

// ---- 候选池细粒度筛选：仅已拥有 / 仅英雄池（胜率·场次门槛） ----
// 排位选人只能选已拥有的英雄，「仅已拥有」默认开；英雄池数据源与 Record 页同款
// （get_match_history_by_name 最近 50 场 + aggregateChampionPool）。两种筛选任一
// 数据不可用（LCU 失败/无召唤师名）时降级为不筛该维度，绝不把候选池清空。

/** 英雄池模块级缓存：召唤师名 → 聚合结果（同一次启动内不重复拉取 50 场战绩） */
const myPoolCache = new Map<string, ChampionPoolEntry[]>()

const OWNED_KEY = 'bestPicksOnlyOwned'
const POOL_ONLY_KEY = 'bestPicksPoolOnly'
const POOL_WIN_RATE_KEY = 'bestPicksPoolMinWinRate'
const POOL_GAMES_KEY = 'bestPicksPoolMinGames'
const COVERAGE_FIRST_KEY = 'bestPicksCoverageFirst'

/** 仅已拥有（默认开：排位池子里的未拥有英雄本来就选不了） */
const onlyOwned = ref(true)
/** 已拥有列表：null = 尚未拉取或拉取失败 */
const ownedIds = ref<number[] | null>(null)
const ownedUnavailable = ref(false)

/** 仅英雄池 */
const poolOnly = ref(false)
/** 我的英雄池：null = 尚未拉取或拉取失败 */
const poolEntries = ref<ChampionPoolEntry[] | null>(null)
const poolLoading = ref(false)
const poolUnavailable = ref(false)
/** 胜率门槛（整数百分比）与场次门槛 */
const poolMinWinRate = ref(50)
const poolMinGames = ref(5)

/** 英雄池维度是否可用（有召唤师名 + 未失败） */
const poolUsable = computed(() => !!props.mySummonerName && !poolUnavailable.value)

/** 优先覆盖：开启后按 counter 敌方人数排序，而非对位分 */
const coverageFirst = ref(false)

/** 协同队友点亮集合：只有点亮（在此集合中）的队友参与协同计算。
 *  初始全亮（空集合 = 全部参与）；点击熄灭则移除、再点击点亮则加入。 */
const litTeammates = ref<Set<number>>(new Set())

function isTeammateLit(championId: number): boolean {
  // 初始空集合 = 全部点亮
  if (litTeammates.value.size === 0) return true
  return litTeammates.value.has(championId)
}

function toggleTeammateLit(championId: number): void {
  const next = new Set(litTeammates.value)
  if (next.size === 0) {
    // 从全亮状态切换：熄灭当前点击的，其余保持点亮
    teammatePicks.value.forEach(t => {
      if (t.championId !== championId) next.add(t.championId)
    })
  } else if (next.has(championId)) {
    next.delete(championId)
  } else {
    next.add(championId)
  }
  litTeammates.value = next
}

/** 有效协同队友：仅点亮状态下的队友参与计算 */
const effectiveTeammateIds = computed(() => {
  if (litTeammates.value.size === 0) return props.teammateIds
  return props.teammateIds.filter(id => litTeammates.value.has(id))
})

/** 筛选不可用时的提示文案（降级为不筛该维度） */
const filterHint = computed(() => {
  if (onlyOwned.value && ownedUnavailable.value) return '已拥有数据未就绪，该筛选未生效'
  if (poolOnly.value && poolUnavailable.value) return '英雄池数据未就绪，该筛选未生效'
  if (poolOnly.value && !props.mySummonerName) return '本局无召唤师信息，英雄池不可用'
  return ''
})

async function loadOwned(): Promise<void> {
  if (ownedUnavailable.value || ownedIds.value !== null) return
  const ids = await getOwnedChampionIds()
  if (ids === null) {
    ownedUnavailable.value = true
    return
  }
  ownedIds.value = ids
}

async function loadMyPool(): Promise<void> {
  if (
    !props.mySummonerName ||
    poolLoading.value ||
    poolUnavailable.value ||
    poolEntries.value !== null
  ) {
    return
  }
  poolLoading.value = true
  try {
    const cached = myPoolCache.get(props.mySummonerName)
    if (cached) {
      poolEntries.value = cached
      return
    }
    const mh = await invoke<MatchHistory>('get_match_history_by_name', {
      name: props.mySummonerName,
      begIndex: 0,
      endIndex: 49
    })
    const entries = aggregateChampionPool(mh?.games?.games ?? [])
    myPoolCache.set(props.mySummonerName, entries)
    poolEntries.value = entries
  } catch (e) {
    console.warn('[bestPicks] 英雄池拉取失败，降级为不筛英雄池:', e)
    poolUnavailable.value = true
  } finally {
    poolLoading.value = false
  }
}

/** 筛选后候选池：已拥有 ∩ 英雄池门槛（各自数据不可用时跳过该维度） */
const filteredCandidates = computed(() => {
  let ids = props.candidateIds
  if (onlyOwned.value && ownedIds.value && ownedIds.value.length > 0) {
    const owned = new Set(ownedIds.value)
    ids = ids.filter(id => owned.has(id))
  }
  if (poolOnly.value && poolEntries.value && poolEntries.value.length > 0) {
    const kept = new Set(
      filterChampionPoolByThresholds(
        poolEntries.value,
        poolMinWinRate.value,
        poolMinGames.value
      ).map(e => e.championId)
    )
    ids = ids.filter(id => kept.has(id))
  }
  return ids
})

// 首次挂载即拉已拥有列表（默认开启，排位场景小请求）
onMounted(async () => {
  void loadOwned()
})

watch(onlyOwned, checked => {
  if (checked) void loadOwned()
})

watch(poolOnly, checked => {
  if (checked) void loadMyPool()
})

// 筛选状态落配置持久化（与 displayCount 同模式，失败静默）
async function persistFilter(key: string, value: boolean | number): Promise<void> {
  try {
    await putConfigByIpc(key, value)
  } catch (e) {
    console.warn('[bestPicks] 筛选配置保存失败:', e)
  }
}

watch(onlyOwned, v => void persistFilter(OWNED_KEY, v))
watch(poolOnly, v => void persistFilter(POOL_ONLY_KEY, v))
watch(poolMinWinRate, v => void persistFilter(POOL_WIN_RATE_KEY, v))
watch(poolMinGames, v => void persistFilter(POOL_GAMES_KEY, v))
watch(coverageFirst, v => void persistFilter(COVERAGE_FIRST_KEY, v))

/** 展示用推荐列表：按显示数量截断（'all' 时全量） */
const shownPicks = computed(() =>
  picks.value.slice(0, displayCount.value === 'all' ? picks.value.length : displayCount.value)
)

/** 常驻条展开提示：数量档位 >= 实际候选数或「全部」时显示展开全部 */
const expandHint = computed(() => {
  const n = displayCount.value
  if (n === 'all' || picks.value.length <= n) return '展开全部'
  return `展开 Top${n}`
})

const { picks, isLoading, error } = useBestPicks(
  computed(() => props.enemyIds),
  filteredCandidates,
  computed(() => props.tier),
  computed(() => props.region),
  effectiveTeammateIds,
  effectivePosition,
  coverageFirst,
  computed(() => props.teammatePositions)
)

/** 显示数量变化：落配置持久化（下次打开仍生效） */
async function onChangeCount(v: number | 'all'): Promise<void> {
  displayCount.value = v
  try {
    await putConfigByIpc(COUNT_CONFIG_KEY, v)
  } catch (e) {
    console.warn('[bestPicks] 显示数量配置保存失败:', e)
  }
}

/** 段位切换：交给父组件统一处理（写配置 + 重拉快照 + 失败回滚） */
function onSwitchTier(v: OpggTier): void {
  emit('switch-tier', v)
}

onMounted(async () => {
  try {
    const saved = await getConfigByIpc<number | string>(COUNT_CONFIG_KEY)
    if (saved === 'all' || (typeof saved === 'number' && COUNT_VALID.includes(saved))) {
      displayCount.value = saved as number | 'all'
    }
  } catch (e) {
    console.warn('[bestPicks] 显示数量配置读取失败:', e)
  }
  try {
    const [owned, poolOnlySaved, winRateSaved, gamesSaved] = await Promise.all([
      getConfigByIpc<boolean>(OWNED_KEY),
      getConfigByIpc<boolean>(POOL_ONLY_KEY),
      getConfigByIpc<number>(POOL_WIN_RATE_KEY),
      getConfigByIpc<number>(POOL_GAMES_KEY)
    ])
    if (typeof owned === 'boolean') onlyOwned.value = owned
    if (typeof poolOnlySaved === 'boolean') poolOnly.value = poolOnlySaved
    if (typeof winRateSaved === 'number' && winRateSaved >= 0 && winRateSaved <= 100) {
      poolMinWinRate.value = winRateSaved
    }
    if (typeof gamesSaved === 'number' && gamesSaved >= 1) poolMinGames.value = gamesSaved
  } catch (e) {
    console.warn('[bestPicks] 筛选配置读取失败，使用默认值:', e)
  }
  try {
    const saved = await getConfigByIpc<boolean>(COVERAGE_FIRST_KEY)
    if (typeof saved === 'boolean') coverageFirst.value = saved
  } catch (e) {
    console.warn('[bestPicks] 优先覆盖配置读取失败:', e)
  }
})

const enemyPicks = computed(() =>
  props.enemyIds.filter(id => id > 0).map(id => ({ championId: id }))
)

const teammatePicks = computed(() =>
  props.teammateIds.filter(id => id > 0).map(id => ({ championId: id }))
)

/** 是否有协同维度参与（队友已亮） */
const hasSynergy = computed(() => teammatePicks.value.length > 0)

/** 敌方锁定 ≥2 人，或队友已亮 ≥1 人时显示（纯协同场景在选人前期即可推荐） */
const visible = computed(() => enemyPicks.value.length >= 2 || teammatePicks.value.length >= 1)

const titleText = computed(() => {
  if (hasSynergy.value && enemyPicks.value.length > 0) return '协同队友 + 应对敌方'
  if (hasSynergy.value) return '与已亮队友协同的最佳选择'
  return '敌方已锁阵容下的最优应对'
})

const emptyText = computed(() => {
  if (allNonPositive.value) return '当前无正面对位优势英雄'
  if (hasSynergy.value) return '暂无协同/对位数据'
  return '敌方尚未锁定英雄'
})

/** 对位子分不能用总分色彩（总分可能为正）——用次级中性色 */
function subScoreClass(score: number): string {
  if (score > 0) return 'score-positive'
  if (score < 0) return 'score-negative'
  return 'score-zero'
}

/** 分数柱宽度：[-1, +1] 映射到 [8%, 100%]（负分也给最小可见条） */
function scoreBarWidth(score: number): string {
  const pct = 8 + ((score + 1) / 2) * 92
  return `${Math.min(100, Math.max(8, pct)).toFixed(1)}%`
}

function scoreClass(score: number): string {
  if (score > 0) return 'score-positive'
  if (score < 0) return 'score-negative'
  return 'score-zero'
}

function scoreText(score: number): string {
  return score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2)
}

function pickTitle(p: DualPick): string {
  return `${championName(p.championId)} 分数 ${scoreText(p.score)}`
}

/** 常驻条左侧标签：协同场景 vs 纯对位场景 */
const barLabel = computed(() => (hasSynergy.value ? '与队友' : '对敌方'))

/** 常驻条箭头文案 */
const barArrowLabel = computed(() => {
  if (hasSynergy.value && enemyPicks.value.length > 0) return '双维最优'
  if (hasSynergy.value) return '最优协同'
  return '最优应对'
})

/** 全部候选分数 ≤ 0：顶部提示「无正面对位优势」 */
const allNonPositive = computed(
  () => picks.value.length > 0 && picks.value.every(p => p.score <= 0)
)

/** 底部来源行附注：当前生效的候选池筛选（供用户核对推荐口径） */
const filterStatusLabel = computed(() => {
  const parts: string[] = []
  if (onlyOwned.value && ownedIds.value && ownedIds.value.length > 0) parts.push('仅已拥有')
  if (poolOnly.value && poolEntries.value && poolEntries.value.length > 0) {
    parts.push(`英雄池≥${poolMinWinRate.value}%·≥${poolMinGames.value}场`)
  }
  return parts.length > 0 ? `筛选：${parts.join('，')}` : ''
})

/**
 * 当前生效的「非默认」筛选 chips（设计系统 v3 §C2-G7）。
 * 与底部 filterStatusLabel 的区别：这里只列偏离默认值的项，点 chip 即恢复该项默认。
 */
const activeFilterChips = computed(() => {
  const chips: Array<{ key: string; label: string; reset: () => void }> = []
  if (positionFilter.value !== 'follow') {
    const opt = PICK_POSITION_OPTIONS.find(o => o.value === positionFilter.value)
    chips.push({
      key: 'pos',
      label: `位置 ${opt?.label ?? String(positionFilter.value)}`,
      reset: () => {
        positionFilter.value = 'follow'
      }
    })
  }
  if (displayCount.value !== 5) {
    const n = displayCount.value
    chips.push({
      key: 'count',
      label: `数量 ${n === 'all' ? '全部' : n}`,
      reset: () => void onChangeCount(5)
    })
  }
  if (!onlyOwned.value) {
    chips.push({
      key: 'owned',
      label: '含未拥有',
      reset: () => {
        onlyOwned.value = true
        void persistFilter(OWNED_KEY, true)
      }
    })
  }
  if (poolOnly.value) {
    chips.push({
      key: 'pool',
      label: '仅英雄池',
      reset: () => {
        poolOnly.value = false
        void persistFilter(POOL_ONLY_KEY, false)
      }
    })
  }
  if (coverageFirst.value) {
    chips.push({
      key: 'coverage',
      label: '优先覆盖',
      reset: () => {
        coverageFirst.value = false
        void persistFilter(COVERAGE_FIRST_KEY, false)
      }
    })
  }
  if (poolOnly.value && poolMinWinRate.value !== 50) {
    const v = poolMinWinRate.value
    chips.push({
      key: 'wr',
      label: `胜率≥${v}%`,
      reset: () => {
        poolMinWinRate.value = 50
        void persistFilter(POOL_WIN_RATE_KEY, 50)
      }
    })
  }
  if (poolOnly.value && poolMinGames.value !== 5) {
    const g = poolMinGames.value
    chips.push({
      key: 'games',
      label: `场次≥${g}`,
      reset: () => {
        poolMinGames.value = 5
        void persistFilter(POOL_GAMES_KEY, 5)
      }
    })
  }
  return chips
})

function championName(id: number): string {
  return getChampionName(id) || `英雄 ${id}`
}
</script>

<style scoped>
.best-picks-panel {
  display: flex;
  justify-content: flex-start;
  width: 100%;
}

.bp-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.25));
  border-radius: 999px;
  background: var(--glass-bg-mid, rgba(128, 128, 128, 0.08));
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.bp-bar:hover {
  border-color: var(--semantic-win, #18a058);
}

.bp-label {
  opacity: 0.8;
}

.bp-enemy-avatars,
.bp-pick-avatars,
.bp-teammate-avatars {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.bp-enemy-avatar,
.bp-pick-avatar,
.bp-teammate-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(128, 128, 128, 0.3);
  flex-shrink: 0;
}

/* 队友头像（协同锚点）：浅绿描边与敌方（灰描边）区分，避免两者混淆 */
.bp-teammate-avatar {
  border-color: color-mix(in srgb, var(--semantic-win, #18a058) 60%, transparent);
  cursor: pointer;
}

.bp-teammate-avatar--dim {
  opacity: 0.3;
  filter: grayscale(1);
}

.bp-arrow-label {
  opacity: 0.8;
  margin-left: 2px;
}

.bp-loading {
  opacity: 0.6;
}

.bp-error-text {
  color: var(--semantic-loss, #d03050);
}

.bp-empty-text {
  opacity: 0.55;
}

.bp-expand-hint {
  margin-left: 4px;
  font-size: 11px;
  opacity: 0.5;
}
.bp-hint-glyph {
  width: 10px;
  height: 10px;
  vertical-align: -1px;
}

.bp-panel-content {
  font-size: 12px;
  color: var(--text-primary, inherit);
  /* 固定面板高度 + 内部上下滚动：内容超高时不再被窗口底缘裁切，
     始终可滚到页脚（含「全部」候选时的长列表）。上限 560px，且不超出视口。 */
  max-height: min(560px, calc(100vh - 64px));
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-right: 2px;
}

.bp-panel-content::-webkit-scrollbar {
  width: 6px;
}

.bp-panel-content::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-tertiary, #888) 45%, transparent);
  border-radius: 999px;
}

.bp-panel-title {
  font-weight: 700;
  margin-bottom: 6px;
}

.bp-panel-count {
  margin-left: 6px;
  font-weight: 400;
  opacity: 0.6;
}

.bp-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}

.bp-control-label {
  font-size: 11px;
  opacity: 0.6;
}

.bp-control {
  width: 118px;
}

/* ---- 生效筛选 chips：点击撤销单项 ---- */
.bp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.bp-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--info-border, rgba(76, 194, 255, 0.3));
  background: var(--info-soft, rgba(76, 194, 255, 0.12));
  color: var(--info, #2ba3e6);
  font-size: var(--font-size-2xs);
  padding: 2px 8px;
  cursor: pointer;
  clip-path: var(--clip-notch);
}
.bp-chip:hover {
  filter: brightness(1.12);
}

/* ---- 候选池细粒度筛选行：仅已拥有 / 仅英雄池（胜率·场次门槛） ---- */
.bp-filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 8px;
  padding: 4px 8px;
  border: 1px solid rgba(128, 128, 128, 0.12);
  border-radius: 6px;
}

.bp-filter-check {
  margin-right: 2px;
}

.bp-filter-label {
  font-size: 11px;
  opacity: 0.7;
}

.bp-filter-num {
  width: 64px;
}

.bp-filter-hint {
  font-size: 11px;
  color: var(--semantic-warn, #d08770);
}

.bp-filter-status {
  font-size: 11px;
  opacity: 0.9;
}

.bp-none-warning {
  margin-bottom: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(208, 135, 112, 0.12);
  color: var(--semantic-warn, #d08770);
}

.bp-pick-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 6px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.1);
}

.bp-pick-card-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  flex-shrink: 0;
}

.bp-pick-card-main {
  flex: 1;
  min-width: 0;
}

.bp-pick-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bp-pick-card-name {
  font-weight: 600;
}

.bp-pick-card-score {
  font-variant-numeric: tabular-nums;
}

.bp-pick-card-subscore {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.score-positive {
  color: var(--semantic-win, #18a058);
}

.score-negative {
  color: var(--semantic-loss, #d03050);
}

.score-zero {
  opacity: 0.6;
}

.bp-pick-card-bar {
  margin-top: 4px;
  height: 4px;
  border-radius: 2px;
  background: rgba(128, 128, 128, 0.15);
  overflow: hidden;
}

.bp-pick-card-bar-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--semantic-win, #18a058);
  opacity: 0.8;
}

.bp-pick-card-evidence {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.bp-evidence-line {
  font-size: 11px;
  opacity: 0.85;
}

.ev-good {
  color: var(--semantic-win, #18a058);
}

.ev-bad {
  color: var(--semantic-loss, #d03050);
}

.ev-synergy {
  color: var(--accent-blue, #59b5ff);
}

.bp-evidence-none {
  font-size: 11px;
  opacity: 0.5;
}

.bp-panel-empty {
  padding: 10px 0;
  opacity: 0.6;
}

.bp-panel-footer {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  opacity: 0.6;
}
</style>
