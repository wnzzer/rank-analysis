<template>
  <section class="score-card" data-test="score-card">
    <header class="score-card-head">
      <img
        class="score-card-avatar"
        :src="getChampionUrl(player.championId)"
        :alt="player.champion"
      />
      <div class="score-card-title">
        <div class="score-card-name" data-test="score-card-name">
          {{ player.champion }}<span v-if="player.isMe" class="score-card-me">（你）</span>
        </div>
        <div class="score-card-meta">
          <span>{{ player.roleCn }}</span>
          <LabelBadge :label="player.label" />
          <span v-if="player.rank" data-test="score-card-rank">{{ player.rank }}</span>
        </div>
      </div>
    </header>

    <div v-if="player.flags.length" class="score-card-flags">
      <span v-for="flag in player.flags" :key="flag" class="score-card-flag" data-test="flag">{{
        flag
      }}</span>
    </div>

    <div v-for="part in player.parts" :key="part.key" class="score-part" data-test="score-part">
      <div class="score-part-row">
        <span class="score-part-name">{{ part.cn }}</span>
        <div class="score-part-track">
          <span class="score-part-mid" />
          <i
            class="score-part-fill"
            :class="toneOf(part)"
            :style="fillStyle(part.bar)"
            data-test="score-part-fill"
          />
        </div>
      </div>
      <div class="score-part-detail">
        {{ part.level }}<template v-if="part.stats.length"> · {{ part.stats.join('、') }}</template>
      </div>
    </div>

    <div class="score-card-note" data-test="score-card-note">
      {{ hasBaseline ? '中线 = 同英雄同位置的国服平均' : '本模式暂无国服基准：中线 = 本局平均' }}
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ② 个人卡：英雄、位置、标签、分位人话；每个分项一条以中线为平均的水平条（左红右绿，截断 ±3），
 * 下一行等级词 + 驱动数据；顶部异常小标签。
 * @property player - 玩家视图
 * @property hasBaseline - 本队列是否有国服基准（无则中线是本局平均，且不显示分位）
 */
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import {
  BAR_LIMIT,
  type PlayerView,
  type ScorePartView
} from '@renderer/services/ai/review/buildReviewModel'
import LabelBadge from './LabelBadge.vue'

defineProps<{ player: PlayerView; hasBaseline: boolean }>()

const { getChampionUrl } = useAssetUrl()

/** 持平灰、领先绿、落后红 */
function toneOf(part: ScorePartView): string {
  if (part.level === '持平') return 'is-even'
  return part.bar > 0 ? 'is-ahead' : 'is-behind'
}

/** 条从中线（50%）向左/右延伸，半宽 50% 对应 ±BAR_LIMIT */
function fillStyle(bar: number): { left: string; width: string } {
  const half = (Math.min(Math.abs(bar), BAR_LIMIT) / BAR_LIMIT) * 50
  return { left: `${bar >= 0 ? 50 : 50 - half}%`, width: `${half}%` }
}
</script>

<style scoped>
.score-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.score-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.score-card-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
}

.score-card-name {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--text-primary);
}

.score-card-me {
  color: var(--accent-gold);
  font-weight: 500;
}

.score-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-6);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.score-card-flags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.score-card-flag {
  padding: 0 var(--space-6);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-2xs);
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 14%, transparent);
}

.score-part-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.score-part-name {
  width: 52px;
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.score-part-track {
  position: relative;
  flex: 1;
  height: 8px;
  border-radius: var(--radius-xs);
  background: var(--stat-dot-empty);
}

.score-part-mid {
  position: absolute;
  left: 50%;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--text-tertiary);
}

.score-part-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--radius-xs);
}

.score-part-fill.is-ahead {
  background: var(--semantic-win);
}

.score-part-fill.is-behind {
  background: var(--semantic-loss);
}

.score-part-fill.is-even {
  background: var(--text-tertiary);
}

.score-part-detail {
  margin: var(--space-2) 0 0 60px;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

.score-card-note {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
</style>
