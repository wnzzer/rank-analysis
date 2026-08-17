<script setup lang="ts">
/**
 * 选人期双方阵容强度对比条（只读，纯展示）。
 *
 * 数据来自 useLineupScore：全局 OP.GG meta + 玩家近期画像加权后的确定性分数。
 * 只在双方都有有效分数（score != null）时渲染；无数据/数据不足时整块隐藏，
 * 绝不编造数字。playerAdjusted 时给「含玩家画像加权」提示。
 */
import { computed } from 'vue'
import type { LineupScore } from '@renderer/services/lineupScore'

const props = defineProps<{
  mine: LineupScore
  enemy: LineupScore
}>()

const visible = computed(() => props.mine.score !== null && props.enemy.score !== null)

/** 双方分数区间展示（40~60 是常态区间，超出后微调刻度避免对比条撑死） */
const SCORE_FLOOR = 40
const SCORE_CEIL = 60

/** 对比条两侧填充比例：分数落在 [40,60] 内按比例，越界收敛到边界 */
function fillOf(score: number): number {
  const clamped = Math.min(SCORE_CEIL, Math.max(SCORE_FLOOR, score))
  return (clamped - SCORE_FLOOR) / (SCORE_CEIL - SCORE_FLOOR)
}

const mineFill = computed(() => (props.mine.score === null ? 0 : fillOf(props.mine.score)))
const enemyFill = computed(() => (props.enemy.score === null ? 0 : fillOf(props.enemy.score)))

const delta = computed(() => {
  const m = props.mine.score
  const e = props.enemy.score
  if (m === null || e === null) return null
  return Math.round((m - e) * 10) / 10
})

const deltaLabel = computed(() => {
  const d = delta.value
  if (d === null) return ''
  if (d === 0) return '双方阵容接近'
  const abs = Math.abs(d).toFixed(1)
  return d > 0 ? `我方领先 ${abs}` : `敌方领先 ${abs}`
})

const deltaClass = computed(() => {
  const d = delta.value
  if (d === null || d === 0) return 'delta-even'
  return d > 0 ? 'delta-ahead' : 'delta-behind'
})

/** 分数文本（0-100 保留 1 位小数） */
function scoreText(s: LineupScore): string {
  return s.score === null ? '--' : s.score.toFixed(1)
}
</script>

<template>
  <div v-if="visible" class="lineup-strength">
    <div class="ls-head">
      <span class="ls-label ls-label-mine">我方阵容</span>
      <span class="ls-value ls-value-mine">{{ scoreText(mine) }}</span>
      <span class="ls-delta" :class="deltaClass">{{ deltaLabel }}</span>
      <span class="ls-value ls-value-enemy">{{ scoreText(enemy) }}</span>
      <span class="ls-label ls-label-enemy">敌方阵容</span>
    </div>

    <div class="ls-bar">
      <div class="ls-bar-segment ls-bar-mine" :style="{ width: `${mineFill * 100}%` }"></div>
      <div class="ls-bar-segment ls-bar-enemy" :style="{ width: `${enemyFill * 100}%` }"></div>
    </div>

    <div class="ls-foot">
      <span v-if="mine.playerAdjusted || enemy.playerAdjusted" class="ls-note">
        已按玩家近期画像加权
      </span>
      <span v-else class="ls-note">OP.GG 全球 meta</span>
      <span class="ls-covered">
        覆盖 {{ mine.covered }}/{{ mine.total }} 我方 · {{ enemy.covered }}/{{ enemy.total }} 敌方
      </span>
    </div>
  </div>
</template>

<style scoped>
.lineup-strength {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-12);
  margin-top: var(--space-8);
  border-radius: var(--radius-md);
  background: var(--glass-bg-low);
}

.ls-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-8);
}

.ls-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.ls-label-mine {
  color: var(--accent-blue);
}

.ls-label-enemy {
  color: var(--semantic-loss-bright);
}

.ls-value {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
}

.ls-value-mine {
  color: var(--accent-blue);
}

.ls-value-enemy {
  color: var(--semantic-loss-bright);
}

.ls-delta {
  flex: 1;
  text-align: center;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.delta-even {
  color: var(--text-tertiary);
}

.delta-ahead {
  color: var(--semantic-win-bright);
}

.delta-behind {
  color: var(--semantic-loss-bright);
}

.ls-bar {
  display: flex;
  height: 6px;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--glass-bg-mid);
}

.ls-bar-segment {
  height: 100%;
  transition: width var(--dur-normal) var(--ease-expo);
}

.ls-bar-mine {
  background: linear-gradient(
    90deg,
    var(--accent-blue),
    color-mix(in srgb, var(--accent-blue) 55%, var(--semantic-win))
  );
}

.ls-bar-enemy {
  background: linear-gradient(90deg, var(--semantic-loss), var(--semantic-loss-bright));
}

.ls-foot {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.ls-note {
  font-style: normal;
}

.ls-covered {
  font-size: var(--font-size-xs);
}
</style>
