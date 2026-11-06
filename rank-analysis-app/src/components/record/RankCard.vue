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
      </div>
      <div class="rank-card-stats">
        <div class="rank-card-win-badge" :class="badgeClass">
          {{ hasGames ? `胜率 ${recent.winRate}%` : '暂无对局' }}
        </div>
        <n-flex justify="space-between" size="small" class="rank-card-stats-row">
          <span class="rank-card-stat-text">胜场: {{ recent.wins }}</span>
          <span class="rank-card-stat-text">负场: {{ recent.losses }}</span>
        </n-flex>
        <n-tooltip v-if="ready" trigger="hover" placement="bottom-start">
          <template #trigger>
            <div class="rank-card-mmr" :class="mmrClass" data-test="hidden-mmr">
              隐藏分 ≈ {{ ready.equivalent }} · {{ ready.score }} {{ directionText }}
            </div>
          </template>
          <div class="rank-card-mmr-tip">
            <div>最近 {{ ready.recent.length }} 局：{{ recentText }}</div>
            <div>
              平均赢 +{{ ready.avgWin }} / 平均输 −{{ ready.avgLoss }}，偏移 {{ signedOffset }}
            </div>
            <div class="rank-card-mmr-disclaimer">估算值，非官方 MMR</div>
          </div>
        </n-tooltip>
        <div v-else-if="collectingText" class="rank-card-mmr muted" data-test="hidden-mmr">
          {{ collectingText }}
        </div>
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

/** 数据收集中的文案；非 collecting 时为空串 */
const collectingText = computed(() => {
  const mmr = props.hiddenMmr
  if (mmr?.status !== 'collecting') return ''
  return mmr.reason === 'one_sided'
    ? '隐藏分 数据收集中（需至少 1 胜 1 负）'
    : `隐藏分 数据收集中 ${mmr.have}/${mmr.need}`
})

/** 颜色沿用胜率徽章的 good / normal / bad 语义 */
const mmrClass = computed(() => {
  if (!ready.value) return ''
  return { up: 'good', flat: 'normal', down: 'bad' }[ready.value.direction]
})

const directionText = computed(() =>
  ready.value ? { up: '↑', flat: '持平', down: '↓' }[ready.value.direction] : ''
)

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

const signedOffset = computed(() => formatSigned(ready.value?.offset ?? 0))

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

.rank-card-mmr {
  margin-top: var(--space-4);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: default;
}

.rank-card-mmr.good {
  color: var(--semantic-win);
}

.rank-card-mmr.bad {
  color: var(--semantic-loss);
}

.rank-card-mmr.muted {
  font-weight: normal;
  color: var(--text-tertiary);
}

.rank-card-mmr-tip {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
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
