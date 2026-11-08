<template>
  <span class="player-chip" :class="{ 'player-chip--mirror': mirror }">
    <img
      class="player-chip-avatar"
      :class="{ 'player-chip-avatar--me': player.isMe }"
      :src="getChampionUrl(player.championId)"
      :alt="player.champion"
    />
    <span class="player-chip-text">
      <span class="player-chip-name">{{ player.champion }}</span>
      <span class="player-chip-kda font-number"
        >{{ player.kills }}/{{ player.deaths }}/{{ player.assists }}</span
      >
    </span>
    <LabelBadge :label="player.label" />
    <span v-if="player.isMe" class="player-chip-me">你</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 对位总览里的一名玩家：头像、英雄名、KDA、标签徽章、「你」标记。
 * @property player - 玩家视图
 * @property mirror - 红方镜像排列（头像在右）
 */
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'
import LabelBadge from './LabelBadge.vue'

withDefaults(defineProps<{ player: PlayerView; mirror?: boolean }>(), { mirror: false })

const { getChampionUrl } = useAssetUrl()
</script>

<style scoped>
.player-chip {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.player-chip--mirror {
  flex-direction: row-reverse;
  text-align: right;
}

.player-chip-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
}

.player-chip-avatar--me {
  outline: 2px solid var(--accent-gold);
}

.player-chip-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.player-chip-name {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-chip-kda {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}

.player-chip-me {
  font-size: var(--font-size-2xs);
  color: var(--accent-gold);
  font-weight: 600;
}
</style>
