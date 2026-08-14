<template>
  <div v-if="visible" class="best-picks-panel" :class="{ 'panel-error': error }">
    <n-popover trigger="click" :width="460" :show-arrow="false">
      <template #trigger>
        <div class="bp-bar" role="button" tabindex="0">
          <span class="bp-label">对敌方</span>
          <span class="bp-enemy-avatars">
            <img
              v-for="e in enemyPicks"
              :key="e.championId"
              class="bp-enemy-avatar"
              :src="getChampionUrl(e.championId)"
              :alt="championName(e.championId)"
            />
          </span>
          <span class="bp-arrow-label">最优应对</span>
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
          <span v-else class="bp-empty-text">暂无正面对位优势英雄</span>
          <span class="bp-expand-hint">▼ 展开 Top5</span>
        </div>
      </template>
      <div class="bp-panel-content">
        <div class="bp-panel-title">
          敌方已锁阵容下的最优应对
          <span class="bp-panel-count">{{ picks.length }} 个候选</span>
        </div>
        <div v-if="allNonPositive" class="bp-none-warning">
          敌方当前阵容下无正面对位优势英雄（以下为相对最不劣）
        </div>
        <n-scrollbar v-if="picks.length > 0" max-height="380px" class="bp-panel-scroll">
          <div v-for="p in picks.slice(0, 5)" :key="p.championId" class="bp-pick-card">
            <img class="bp-pick-card-avatar" :src="getChampionUrl(p.championId)" alt="" />
            <div class="bp-pick-card-main">
              <div class="bp-pick-card-head">
                <span class="bp-pick-card-name">{{ championName(p.championId) }}</span>
                <span class="bp-pick-card-score" :class="scoreClass(p.score)"
                  >分数 {{ scoreText(p.score) }}</span
                >
              </div>
              <div class="bp-pick-card-bar">
                <span class="bp-pick-card-bar-fill" :style="{ width: scoreBarWidth(p.score) }" />
              </div>
              <div class="bp-pick-card-evidence">
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
                <span v-if="p.evidences.length === 0" class="bp-evidence-none">
                  其余敌方对位无 OP.GG 数据
                </span>
              </div>
            </div>
          </div>
        </n-scrollbar>
        <div v-else-if="!error && !isLoading" class="bp-panel-empty">
          {{ allNonPositive ? '当前无正面对位优势英雄' : '敌方尚未锁定英雄' }}
        </div>
        <div class="bp-panel-footer">
          <span>按敌方已锁定英雄计算</span>
          <span class="bp-panel-source">OP.GG {{ region }} · {{ tier }}</span>
        </div>
      </div>
    </n-popover>
  </div>
</template>

<script setup lang="ts">
/**
 * 敌方已锁阵容 → 我方最优应对推荐条（P2）。
 *
 * 敌方锁定 ≥2 人时显示在敌方 SubteamCard 正上方；常驻条展示敌方已锁头像 + Top3 应对，
 * 点击展开 Top5 卡（头像/名字/分数 bar/逐条对位证据）。数据来自 [`useBestPicks`]：
 * 反查敌方 intel 评分（请求数 = |已锁敌方| ≤ 5），未知对位记 0 不编造。
 *
 * 隐藏规则由父组件控制（仅 ranked && ChampSelect 渲染本组件）。
 */
import { computed } from 'vue'
import { NPopover, NScrollbar } from 'naive-ui'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { formatCounterLine, type BestPick } from '@renderer/services/counterIntel'
import { useBestPicks } from '@renderer/composables/useCounterIntel'
import { getChampionName } from '@renderer/services/ai/champion-names'

const props = withDefaults(
  defineProps<{
    /** 敌方已锁英雄 ID（>0 已锁定） */
    enemyIds: number[]
    /** 排除 ban/锁定/intent 后的候选英雄 ID（全量可选池） */
    candidateIds: number[]
    /** OP.GG 段位分段 */
    tier: string
    /** 区域 */
    region?: string
  }>(),
  { region: 'global' }
)

const { getChampionUrl } = useAssetUrl()

const { picks, isLoading, error } = useBestPicks(
  computed(() => props.enemyIds),
  computed(() => props.candidateIds),
  computed(() => props.tier),
  computed(() => props.region)
)

const enemyPicks = computed(() =>
  props.enemyIds.filter(id => id > 0).map(id => ({ championId: id }))
)

/** 敌方锁定 ≥2 人才显示（1 人时弹窗/单卡已够用，避免视觉噪音） */
const visible = computed(() => enemyPicks.value.length >= 2)

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

function pickTitle(p: BestPick): string {
  return `${championName(p.championId)} 分数 ${scoreText(p.score)}`
}

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
