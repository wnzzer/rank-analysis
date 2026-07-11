<template>
  <div class="meeting-players-container">
    <n-grid :x-gap="8" :y-gap="8" cols="2">
      <n-grid-item v-for="meetGame in meetGames" :key="meetGame.gameId">
        <div
          class="game-card"
          :class="{ 'is-win': meetGame.win, 'is-loss': !meetGame.win }"
          @click="openGameDetail(meetGame.gameId)"
        >
          <!-- Left: Champion -->
          <div class="champion-section">
            <LazyImg
              :src="assetPrefix + '/champion/' + meetGame.championId"
              alt="champion"
              class="champion-img"
            />
          </div>

          <!-- Middle: Stats & Info -->
          <div class="info-section">
            <div class="kda-row font-number">
              <span class="kda-val kill">{{ meetGame.kills }}</span>
              <span class="kda-sep">/</span>
              <span class="kda-val death">{{ meetGame.deaths }}</span>
              <span class="kda-sep">/</span>
              <span class="kda-val assist">{{ meetGame.assists }}</span>
            </div>
            <div class="meta-row">
              <span class="mode-text">{{ meetGame.queueIdCn || '其他' }}</span>
              <span class="date-text">{{ getFormattedDate(meetGame.gameCreatedAt) }}</span>
            </div>
          </div>

          <!-- Right: Result & Relation -->
          <div class="status-section">
            <div class="result-text" :class="meetGame.win ? 'text-win' : 'text-loss'">
              {{ meetGame.win ? '胜利' : '失败' }}
            </div>
            <div class="relation-badge" :class="meetGame.isMyTeam ? 'is-friend' : 'is-enemy'">
              {{ meetGame.isMyTeam ? '友方' : '敌方' }}
            </div>
          </div>
        </div>
      </n-grid-item>
    </n-grid>
  </div>
</template>
<script setup lang="ts">
import { OneGamePlayer } from '../record/type'
import type { Game } from '../record/match'
import { assetPrefix } from '../../services/http'
import { openMatchDetailWindow } from '../record/detailWindow'
import { invoke } from '@tauri-apps/api/core'
import LazyImg from '@renderer/components/common/LazyImg.vue'

function getFormattedDate(dateString: string) {
  const date = new Date(dateString)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${month}-${day}`
}

/**
 * 打开对局详情窗口
 * @param gameId - 对局 ID
 */
async function openGameDetail(gameId: number): Promise<void> {
  try {
    // 通过 gameId 获取完整对局信息
    const game = await invoke<Game>('get_game_by_id', { gameId })
    if (game) {
      await openMatchDetailWindow(game)
    }
  } catch (error) {
    console.error('Failed to open game detail:', error)
  }
}

defineProps<{
  meetGames: OneGamePlayer[]
}>()
</script>

<style scoped>
.meeting-players-container {
  max-width: 540px;
}

.game-card {
  display: flex;
  align-items: center;
  padding: var(--space-6) var(--space-8);
  border-radius: var(--radius-md);
  background-color: var(--glass-bg-low);
  border: 1px solid transparent;
  transition: all var(--dur-fast) var(--ease-expo);
  /* 固定 48px 行高：保证栅格视觉对齐 */
  height: 48px;
  box-sizing: border-box;
  cursor: pointer;
}

.game-card:hover {
  background-color: var(--glass-bg-high);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.game-card:active {
  transform: translateY(0);
}

.game-card.is-win {
  border-left: 3px solid var(--semantic-win);
  /* tinted gradient：保留 rgba 平铺，仅作为半透明背景渲染 */
  background: linear-gradient(90deg, rgba(139, 223, 183, 0.1) 0%, rgba(0, 0, 0, 0) 100%);
}

.game-card.is-loss {
  border-left: 3px solid var(--semantic-loss);
  background: linear-gradient(90deg, rgba(186, 63, 83, 0.1) 0%, rgba(0, 0, 0, 0) 100%);
}

.champion-section {
  margin-right: var(--space-8);
  display: flex;
  align-items: center;
}

/* 固定 32px 英雄方头像：像素精确布局，不取 token 阶 */
.champion-img {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
}

.champion-img :deep(img) {
  object-fit: cover;
}

.info-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: var(--line-height-tight);
  overflow: hidden;
}

.kda-row {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
}

.kda-val.kill {
  color: var(--semantic-win);
}

.kda-val.death {
  color: var(--semantic-loss);
}

.kda-val.assist {
  color: var(--semantic-warn);
}

.kda-sep {
  color: var(--text-tertiary);
  margin: 0 var(--space-2);
  font-size: var(--font-size-xs);
}

.meta-row {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  margin-top: var(--space-2);
  display: flex;
  gap: var(--space-6);
  white-space: nowrap;
}

.status-section {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  min-width: 32px;
  margin-left: var(--space-4);
}

.result-text {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  margin-bottom: var(--space-2);
}

.text-win {
  color: var(--semantic-win);
}

.text-loss {
  color: var(--semantic-loss);
}

.relation-badge {
  font-size: var(--font-size-2xs);
  /* 1px：徽标紧凑内边距，非 token 阶 */
  padding: 1px var(--space-4);
  border-radius: var(--radius-sm);
  background-color: var(--glass-bg-high);
}

.relation-badge.is-friend {
  color: var(--semantic-win);
  /* tinted badge bg：保留 rgba 以保持半透明 hover 视觉 */
  background-color: rgba(139, 223, 183, 0.15);
}

.relation-badge.is-enemy {
  color: var(--semantic-loss);
  background-color: rgba(186, 63, 83, 0.15);
}
</style>
