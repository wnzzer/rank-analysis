<template>
  <div v-if="visible" class="best-picks-panel" :class="{ 'panel-error': error }">
    <n-popover trigger="click" :width="460" :show-arrow="false">
      <template #trigger>
        <div class="bp-bar" role="button" tabindex="0">
          <span class="bp-label">{{ barLabel }}</span>
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
          <span class="bp-expand-hint">▼ {{ expandHint }}</span>
        </div>
      </template>
      <div class="bp-panel-content">
        <div class="bp-panel-title">
          {{ titleText }}
          <span class="bp-panel-count">{{ shownPicks.length }}/{{ picks.length }} 个候选</span>
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
          <span class="bp-panel-source">OP.GG {{ region }} · {{ tier }}</span>
        </div>
      </div>
    </n-popover>
  </div>
</template>

<script setup lang="ts">
/**
 * 已亮阵容 → 我方最优推荐条（P2 对位 + P3 协同双维）。
 *
 * 展示条件：敌方锁定 ≥2，或我方队友已亮 ≥1（纯协同场景）。常驻条展示
 * 敌方/队友头像 + Top3 推荐；点击展开 Top5 卡（头像/名字/总分 bar/
 * 协同子分/对位子分/逐条证据）。数据来自 [`useBestPicks`]：反查敌方
 * counters + 命中队友 synergies 融合评分，未知对位/协同记 0 不编造。
 *
 * 隐藏规则由父组件控制（仅 ranked && ChampSelect 渲染本组件）。
 */
import { computed, onMounted, ref } from 'vue'
import { NPopover, NScrollbar, NSelect } from 'naive-ui'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import {
  formatCounterLine,
  PICK_POSITION_OPTIONS,
  resolvePanelPosition,
  type DualPick,
  type PickPositionFilter
} from '@renderer/services/counterIntel'
import { useBestPicks } from '@renderer/composables/useCounterIntel'
import { getChampionName } from '@renderer/services/ai/champion-names'
import { TIER_OPTIONS, type OpggTier } from '@renderer/services/opgg'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'

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
    /** 我本局分路（LCU 命名，大小写均可；空 = 不过滤候选位置） */
    myPosition?: string
  }>(),
  { tierLoading: false, region: 'global', teammateIds: () => [], myPosition: '' }
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
  computed(() => props.candidateIds),
  computed(() => props.tier),
  computed(() => props.region),
  computed(() => props.teammateIds),
  effectivePosition
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
.bp-pick-avatars {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.bp-enemy-avatar,
.bp-pick-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(128, 128, 128, 0.3);
  flex-shrink: 0;
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

.bp-panel-content {
  font-size: 12px;
  color: var(--text-primary, inherit);
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
