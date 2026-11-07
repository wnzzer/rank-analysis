<template>
  <n-card
    class="rank-card record-panel-card panel-glass"
    :bordered="false"
    size="small"
    :content-style="cardContentStyle"
  >
    <div v-if="loading" class="rank-card-content" aria-hidden="true">
      <div class="rank-card-icon-wrapper">
        <span class="rank-card-type-label">{{ label }}</span>
        <span class="sk sk-circle rank-card-sk-emblem" />
        <span class="sk rank-card-sk-tier" />
        <span class="sk rank-card-sk-ladder" />
      </div>
      <div class="rank-card-stats">
        <span class="sk rank-card-sk-badge" />
        <span class="sk rank-card-sk-line" />
      </div>
    </div>
    <div v-else class="rank-card-content sk-reveal">
      <div class="rank-card-icon-wrapper">
        <span class="rank-card-type-label">{{ label }}</span>
        <img :src="tierImage(queueInfo.tier)" class="rank-card-img" />
        <div class="rank-card-tier-text">
          {{ formatTierText(queueInfo) }}
        </div>
        <div
          v-if="typeof queueInfo.ladderScore === 'number'"
          class="rank-card-ladder"
          data-test="ladder-score"
        >
          <span class="rank-card-ladder-value">{{ queueInfo.ladderScore }}</span
          ><span class="rank-card-ladder-unit">分</span>
        </div>
      </div>
      <div class="rank-card-stats">
        <div class="rank-card-win-badge" :class="badgeClass">
          {{ hasGames ? `胜率 ${recent.winRate}%` : '暂无对局' }}
        </div>
        <n-flex justify="space-between" size="small" class="rank-card-stats-row">
          <span class="rank-card-stat-text">胜场: {{ recent.wins }}</span>
          <span class="rank-card-stat-text">负场: {{ recent.losses }}</span>
        </n-flex>
        <n-tooltip v-if="mmrLine" trigger="hover" placement="bottom-start">
          <template #trigger>
            <div class="rank-card-mmr" data-test="hidden-mmr">
              {{ mmrLine }}
              <span v-if="ready && arrow" class="rank-card-mmr-arrow" :class="ready.direction">{{
                arrow
              }}</span>
            </div>
          </template>
          <div class="rank-card-mmr-tip">
            <template v-if="ready">
              <div>≈ {{ ready.equivalent }}（{{ ready.score }}）</div>
              <div v-if="ladderCompare">{{ ladderCompare }}</div>
              <div>最近 {{ ready.recent.length }} 局：{{ recentText }}</div>
              <div>平均赢 +{{ ready.avgWin }} / 平均输 −{{ ready.avgLoss }}</div>
            </template>
            <div v-else-if="collecting">
              已记录 {{ collecting.have }} 局有效排位，至少需要 {{ collecting.need }} 局且有胜有负
            </div>
            <div class="rank-card-mmr-rules">
              <div class="rank-card-mmr-rules-title">计算规则</div>
              <div>1. 每局排位结束后记录 LP 加减分（挂机、定级赛、掉段保护不计入）</div>
              <div>2. 取最近 10 局：隐藏分 ≈ 天梯分 +（平均赢分 − 平均输分）× 10</div>
              <div>3. 赢得多输得少 → 隐藏分高于段位</div>
            </div>
            <div class="rank-card-mmr-disclaimer">估算值，非官方 MMR</div>
          </div>
        </n-tooltip>
      </div>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NFlex, NTooltip } from 'naive-ui'
import type { HiddenMmr } from '@renderer/services/hiddenMmr'
import type { QueueInfo } from '@renderer/types/domain/player'
import type { RecentWinRate } from '@renderer/types/domain/player'
import { formatTierText } from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'

const props = defineProps<{
  label: string
  queueInfo: QueueInfo
  recent: RecentWinRate
  /** 数据未到：渲染骨架而非「无段位 / 暂无对局 / 0 胜 0 负」假值 */
  loading?: boolean
  /** 隐藏分估算；仅查看自己时由 UserRecord 传入，null / 缺省 / hidden 时不显示这一行 */
  hiddenMmr?: HiddenMmr | null
}>()

/** 0 胜 0 负说明该队列没打过，红色「胜率 0%」会被误读成连败 */
const hasGames = computed(() => props.recent.wins + props.recent.losses > 0)

const badgeClass = computed(() => {
  if (!hasGames.value) return 'normal'
  if (props.recent.winRate >= 58) return 'good'
  if (props.recent.winRate <= 49) return 'bad'
  return 'normal'
})

/** status 为 ready 时的估算（模板里用它做类型收窄） */
const ready = computed(() => (props.hiddenMmr?.status === 'ready' ? props.hiddenMmr : null))

/** status 为 collecting 时的进度（模板里用它做类型收窄） */
const collecting = computed(() =>
  props.hiddenMmr?.status === 'collecting' ? props.hiddenMmr : null
)

/** 隐藏分那一行的文案（不含箭头）；hidden / 缺省时为空串，整行不渲染 */
const mmrLine = computed(() => {
  if (ready.value) return `隐藏分 ${ready.value.score}`
  const mmr = collecting.value
  if (!mmr) return ''
  return mmr.reason === 'one_sided'
    ? '隐藏分 收集中（需有胜有负）'
    : `隐藏分 收集中 ${mmr.have}/${mmr.need}`
})

/** 方向箭头；持平不显示 */
const arrow = computed(() =>
  ready.value ? { up: '↑', flat: '', down: '↓' }[ready.value.direction] : ''
)

/** tooltip 里隐藏分与天梯分的对比；没有天梯分时为空串 */
const ladderCompare = computed(() => {
  const ladder = props.queueInfo.ladderScore
  if (!ready.value || typeof ladder !== 'number') return ''
  const diff = ready.value.score - ladder
  if (diff === 0) return '与天梯分持平'
  return `比天梯分${diff > 0 ? '高' : '低'} ${Math.abs(diff)}`
})

/**
 * 带符号数字：正数加 `+`，负数用 U+2212 减号（与「平均输 −」一致），零原样输出
 */
function formatSigned(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${-n}`
  return '0'
}

/** tooltip 里的逐局加减分，新 → 旧 */
const recentText = computed(
  () => ready.value?.recent.map(r => formatSigned(r.delta)).join(' / ') ?? ''
)

// n-card 的 content-style 需要字符串/对象,这里用 token 占位以避免 inline 字面量
const cardContentStyle = 'padding: var(--space-10)'
</script>

<style scoped>
.rank-card-content {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.rank-card-icon-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 70px;
}

.rank-card-type-label {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  position: absolute;
  top: calc(var(--space-8) * -1);
  left: 0;
}

.rank-card-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.rank-card-tier-text {
  font-size: var(--font-size-sm);
  white-space: nowrap;
  font-weight: bold;
  text-align: center;
  line-height: var(--line-height-tight);
  margin-top: calc(var(--space-4) * -1);
}

.rank-card-stats {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.rank-card-stats-row {
  width: 100%;
  margin-top: var(--space-4);
}

.rank-card-stat-text {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.rank-card-win-badge {
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: bold;
  background: var(--surface-sunken);
  border: 1px solid var(--sunken-border);
}

.rank-card-win-badge.good {
  color: var(--semantic-win);
  background: color-mix(in srgb, var(--semantic-win) 14%, transparent);
  border-color: color-mix(in srgb, var(--semantic-win) 22%, transparent);
}

.rank-card-win-badge.bad {
  color: var(--semantic-loss);
  background: color-mix(in srgb, var(--semantic-loss) 10%, transparent);
  border-color: color-mix(in srgb, var(--semantic-loss) 18%, transparent);
}

.rank-card-win-badge.normal {
  color: var(--text-secondary);
}

.rank-card-ladder {
  text-align: center;
  line-height: var(--line-height-tight);
  margin-top: var(--space-2);
}

.rank-card-ladder-value {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.rank-card-ladder-unit {
  margin-left: var(--space-2);
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

/* 隐藏分：低调的一行灰色小字，只有箭头带颜色 */
.rank-card-mmr {
  margin-top: var(--space-4);
  font-size: var(--font-size-2xs);
  font-weight: normal;
  color: var(--text-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  cursor: default;
}

.rank-card-mmr-arrow.up {
  color: var(--semantic-win);
}

.rank-card-mmr-arrow.down {
  color: var(--semantic-loss);
}

.rank-card-mmr-tip {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
}

.rank-card-mmr-rules {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
  font-size: var(--font-size-2xs);
}

.rank-card-mmr-rules-title {
  font-weight: 600;
}

.rank-card-mmr-disclaimer {
  color: var(--text-tertiary);
}

/* 骨架尺寸对齐真实内容：徽标 56px + 段位文字行 ≈ 66px 高，不因揭晓而跳 */
.rank-card-sk-emblem {
  width: 56px;
  height: 56px;
}

.rank-card-sk-tier {
  width: 52px;
  height: 10px;
}

.rank-card-sk-ladder {
  width: 40px;
  height: 14px;
  margin-top: var(--space-4);
}

.rank-card-sk-badge {
  width: 72px;
  height: 22px;
}

.rank-card-sk-line {
  width: 100%;
  height: 12px;
  margin-top: var(--space-8);
}
</style>
