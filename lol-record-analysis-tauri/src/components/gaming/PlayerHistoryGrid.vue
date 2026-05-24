<template>
  <div class="history-grid">
    <div
      v-for="(game, index) in games"
      :key="index"
      class="history-item"
      :class="{ 'is-win': game.participants[0].stats.win }"
    >
      <div class="history-row">
        <span class="win-status" :class="{ 'is-win': game.participants[0].stats.win }">
          {{ game.participants[0].stats.win ? '胜' : '负' }}
        </span>
        <LazyImg
          :src="assetPrefix + '/champion/' + game.participants[0]?.championId"
          alt="champion"
          class="history-champ-img"
        />
        <div class="kda-text">
          <span class="kill">{{ game.participants[0].stats?.kills }}</span>
          / <span class="death">{{ game.participants[0].stats?.deaths }}</span> /
          <span class="assist">{{ game.participants[0].stats?.assists }}</span>
        </div>
        <n-tooltip trigger="hover">
          <template #trigger>
            <span class="queue-name">{{ game.queueName || '其他' }}</span>
          </template>
          {{ game.queueName || '其他' }}
        </n-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NTooltip } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import { assetPrefix } from '@renderer/services/http'
import LazyImg from '@renderer/components/common/LazyImg.vue'

defineProps<{ games: Game[] }>()
</script>

<style scoped>
.history-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* 行按内容高度，避免被 stretch 撑高 */
  grid-auto-rows: min-content;
  /* 行集合在 grid 容器内垂直居中 */
  align-content: center;
  /* 列间 3px 紧凑，行间 6px 配合 1 屏布局 */
  column-gap: 3px;
  row-gap: var(--space-6);
  flex: 1;
  overflow-y: auto;
}

.history-item {
  background: var(--glass-bg-low);
  border-radius: var(--radius-sm);
  /* P0 收紧到 4px 配合 1 屏 4 场布局 */
  padding: var(--space-4) 5px;
  font-size: var(--font-size-2xs);
  border: 1px solid var(--glass-border);
  /* P1: 左侧锚点 2px + 半透明，更轻盈 */
  border-left-width: 2px;
  border-left-color: color-mix(in srgb, var(--semantic-loss) 70%, transparent);
}

.history-item.is-win {
  border-left-color: color-mix(in srgb, var(--semantic-win) 70%, transparent);
}

/* 固定列宽 grid：胜负 / 头像 / KDA / 模式 —— 跨行跨卡片严格对齐 */
.history-row {
  display: grid;
  grid-template-columns: 18px 24px 1fr 60px;
  align-items: center;
  gap: var(--space-6);
}

.win-status {
  /* P1: 11px + bold，保持识别但不抢戏 */
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--semantic-loss);
  text-align: center;
}

.win-status.is-win {
  color: var(--semantic-win);
}

/* P1 精致化：22px 圆形英雄头像 */
.history-champ-img {
  width: 22px;
  height: 22px;
  border-radius: 50%;
}

.history-champ-img :deep(img) {
  object-fit: cover;
}

.kda-text {
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-weight: var(--font-weight-bold);
  font-size: var(--font-size-sm);
  /* tabular-nums: 数字等宽，确保 5/17/20 与 23/12/39 的斜杠纵向对齐 */
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
}

.kill {
  color: var(--semantic-win);
}

.death {
  color: var(--semantic-loss);
}

.assist {
  color: var(--text-secondary);
}

.queue-name {
  /* P1: 容器收紧后 10px 灰阶刚好 */
  font-size: var(--font-size-2xs);
  color: var(--n-text-color-3);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
