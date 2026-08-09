<template>
  <div class="relationship-col">
    <div class="relationship-header" :class="variant === 'friend' ? 'good-color' : 'bad-color'">
      <n-icon>
        <AccessibilityOutline v-if="variant === 'friend'" />
        <FlashOutline v-else />
      </n-icon>
      <span>{{ variant === 'friend' ? '好友/胜率' : '宿敌/胜率' }}</span>
    </div>
    <div class="relationship-list">
      <n-empty v-if="summoners.length === 0" description="暂无数据" size="small" />
      <n-popover
        v-for="entry in summoners"
        :key="entry.Summoner.puuid"
        trigger="hover"
        placement="right"
      >
        <template #trigger>
          <div class="relationship-item">
            <n-avatar
              round
              :size="24"
              :src="`${assetPrefix}/profile/${entry?.Summoner?.profileIconId}`"
            />
            <n-ellipsis class="relationship-name">
              {{ entry?.Summoner?.gameName }}
            </n-ellipsis>
            <span class="relationship-rate" :style="{ color: winRateColor(entry.winRate, isDark) }">
              {{ entry.winRate }}
            </span>
          </div>
        </template>
        <MettingPlayersCard :meet-games="entry.OneGamePlayer" />
      </n-popover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AccessibilityOutline, FlashOutline } from '@vicons/ionicons5'
import { NIcon, NEmpty, NPopover, NAvatar, NEllipsis } from 'naive-ui'
import MettingPlayersCard from '@renderer/components/gaming/MettingPlayersCard.vue'
import { assetPrefix } from '@renderer/services/http'
import { winRateColor } from '@renderer/utils/colors'
import type { OneGamePlayerSummoner } from '@renderer/types/domain/analysis'

defineProps<{
  variant: 'friend' | 'dispute'
  summoners: OneGamePlayerSummoner[]
  isDark: boolean
}>()
</script>

<style scoped>
.relationship-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.relationship-header {
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-8);
  font-size: var(--font-size-base);
}

.relationship-header.good-color {
  color: var(--semantic-win);
}

.relationship-header.bad-color {
  color: var(--semantic-loss);
}

.relationship-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.relationship-item {
  display: flex;
  align-items: center;
  background-color: var(--bg-elevated);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-expo);
}

.relationship-item:hover {
  background-color: var(--glass-bg-high);
}

.relationship-name {
  flex: 1;
  margin: 0 var(--space-6);
  font-size: var(--font-size-sm);
}

.relationship-rate {
  font-weight: bold;
  font-size: var(--font-size-sm);
}
</style>
