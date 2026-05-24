<template>
  <div class="history-grid">
    <div
      v-for="(game, index) in games"
      :key="index"
      class="history-item"
      :class="{ 'is-win': game.participants[0].stats.win }"
    >
      <n-flex justify="space-between" align="center" :wrap="false">
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
      </n-flex>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NFlex, NTooltip } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import { assetPrefix } from '@renderer/services/http'
import LazyImg from '@renderer/components/common/LazyImg.vue'

defineProps<{ games: Game[] }>()
</script>

<style scoped>
.history-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* 3px：紧凑历史栅格的密集间隙，非 token 阶 */
  gap: 3px;
  flex: 1;
  overflow-y: auto;
}

.history-item {
  background: var(--glass-bg-low);
  border-radius: var(--radius-sm);
  /* 3px / 5px：紧凑卡片内边距，非 token 阶 */
  padding: 3px 5px;
  font-size: var(--font-size-2xs);
  border: 1px solid var(--glass-border);
  border-left-width: 2px;
  border-left-color: var(--semantic-loss);
}

.history-item.is-win {
  border-left-color: var(--semantic-win);
}

.win-status {
  font-weight: var(--font-weight-semibold);
  color: var(--semantic-loss);
  width: 20px;
  flex-shrink: 0;
}

.win-status.is-win {
  color: var(--semantic-win);
}

/* 固定 24px 圆形英雄头像：像素级精确布局，不取 token 阶 */
.history-champ-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.history-champ-img :deep(img) {
  object-fit: cover;
}

.kda-text {
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-weight: var(--font-weight-bold);
  font-size: var(--font-size-sm);
  /* 固定 60px 列宽：保持栅格对齐 */
  min-width: 60px;
  text-align: center;
  white-space: nowrap;
  flex-shrink: 0;
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
  font-size: var(--font-size-2xs);
  color: var(--n-text-color-3);
  /* 固定 40px 列宽 */
  width: 40px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
