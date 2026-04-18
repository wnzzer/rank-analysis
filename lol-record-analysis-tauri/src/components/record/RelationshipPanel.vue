<template>
  <div class="relationship-col">
    <div class="section-header" :class="variant === 'friend' ? 'good-color' : 'bad-color'">
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
            <n-ellipsis style="flex: 1; margin: 0 6px; font-size: 12px">
              {{ entry?.Summoner?.gameName }}
            </n-ellipsis>
            <span
              :style="{
                color: winRateColor(entry.winRate, isDark),
                fontWeight: 'bold',
                fontSize: '12px'
              }"
            >
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

.section-header {
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 13px;
}

.section-header.good-color {
  color: var(--semantic-win);
}

.section-header.bad-color {
  color: var(--semantic-loss);
}

.relationship-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
</style>
