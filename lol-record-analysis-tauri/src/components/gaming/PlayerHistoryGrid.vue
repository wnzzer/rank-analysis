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
        <img
          :src="assetPrefix + '/champion/' + game.participants[0]?.championId"
          class="history-champ-img"
          loading="lazy"
          decoding="async"
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

defineProps<{ games: Game[] }>()
</script>

<style scoped>
.history-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  flex: 1;
  overflow-y: auto;
}

.history-item {
  background: var(--glass-bg-low);
  border-radius: var(--radius-sm);
  padding: 3px 5px;
  font-size: 10px;
  border: 1px solid var(--glass-border);
  border-left-width: 2px;
  border-left-color: var(--semantic-loss);
}

.history-item.is-win {
  border-left-color: var(--semantic-win);
}

.win-status {
  font-weight: 600;
  color: var(--semantic-loss);
  width: 20px;
  flex-shrink: 0;
}

.win-status.is-win {
  color: var(--semantic-win);
}

.history-champ-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.kda-text {
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: 12px;
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
  font-size: 10px;
  color: var(--n-text-color-3);
  width: 40px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
