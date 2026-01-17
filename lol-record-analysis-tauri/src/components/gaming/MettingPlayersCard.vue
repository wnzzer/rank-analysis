<template>
  <div class="meeting-players-container">
    <n-grid :x-gap="8" :y-gap="8" cols="2">
      <n-grid-item v-for="meetGame in meetGames" :key="meetGame.gameId">
        <div class="game-card" :class="{ 'is-win': meetGame.win, 'is-loss': !meetGame.win }">
          <!-- Left: Champion -->
          <div class="champion-section">
            <img :src="assetPrefix + '/champion/' + meetGame.championId" class="champion-img" />
          </div>

          <!-- Middle: Stats & Info -->
          <div class="info-section">
            <div class="kda-row">
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
import { assetPrefix } from '../../services/http'

function getFormattedDate(dateString: string) {
  const date = new Date(dateString)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${month}-${day}`
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
  padding: 6px 8px;
  border-radius: 6px;
  background-color: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  transition: all 0.2s ease;
  height: 48px;
  box-sizing: border-box;
}

.game-card:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.game-card.is-win {
  border-left: 3px solid #8bdfb7;
  background: linear-gradient(90deg, rgba(139, 223, 183, 0.1) 0%, rgba(0, 0, 0, 0) 100%);
}

.game-card.is-loss {
  border-left: 3px solid #ba3f53;
  background: linear-gradient(90deg, rgba(186, 63, 83, 0.1) 0%, rgba(0, 0, 0, 0) 100%);
}

.champion-section {
  margin-right: 8px;
  display: flex;
  align-items: center;
}

.champion-img {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  object-fit: cover;
}

.info-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.2;
  overflow: hidden;
}

.kda-row {
  font-size: 13px;
  font-weight: 600;
  font-family: 'Oswald', sans-serif;
  white-space: nowrap;
}

.kda-val.kill {
  color: #8bdfb7;
}

.kda-val.death {
  color: #ba3f53;
}

.kda-val.assist {
  color: #d38b2a;
}

.kda-sep {
  color: #666;
  margin: 0 2px;
  font-size: 11px;
}

.meta-row {
  font-size: 10px;
  color: #999;
  margin-top: 2px;
  display: flex;
  gap: 6px;
  white-space: nowrap;
}

.status-section {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  min-width: 32px;
  margin-left: 4px;
}

.result-text {
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 2px;
}

.text-win {
  color: #8bdfb7;
}

.text-loss {
  color: #ba3f53;
}

.relation-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background-color: rgba(255, 255, 255, 0.1);
}

.relation-badge.is-friend {
  color: #8bdfb7;
  background-color: rgba(139, 223, 183, 0.15);
}

.relation-badge.is-enemy {
  color: #ba3f53;
  background-color: rgba(186, 63, 83, 0.15);
}
</style>
