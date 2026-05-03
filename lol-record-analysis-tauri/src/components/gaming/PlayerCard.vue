<template>
  <n-card
    class="player-card"
    :class="[
      { 'light-mode-strip': settingsStore.theme?.name === 'Light' },
      props.team === 'blue' && 'player-card-team-blue',
      props.team === 'red' && 'player-card-team-red'
    ]"
    size="small"
    :bordered="true"
    content-style="padding: 8px;"
  >
    <div v-if="sessionSummoner.isLoading" key="loading-known" class="loading-container">
      <div class="custom-spin"></div>
      <span v-if="sessionSummoner.summoner.gameName" style="font-size: 12px; color: #aaa">
        {{ sessionSummoner.summoner.gameName }}
      </span>
    </div>
    <!-- 仅返回英雄 id、无 summoner 有效信息时视为隐藏战绩 -->
    <div v-else-if="isHiddenRecord" key="hidden-record" class="hidden-record-block">
      <n-flex vertical align="center" class="hidden-record-inner">
        <n-avatar
          round
          :size="48"
          :src="assetPrefix + '/champion/' + sessionSummoner.championId"
          :fallback-src="nullImg"
          class="hidden-record-avatar"
          style="opacity: 0.45"
        />
        <span class="hidden-record-text">战绩已隐藏</span>
      </n-flex>
    </div>
    <div
      v-else-if="!sessionSummoner.summoner.gameName"
      key="loading-unknown"
      class="loading-container"
    >
      <div class="custom-spin"></div>
    </div>
    <n-flex v-else key="content" style="height: 100%" :wrap="false">
      <!-- Left Side: Profile & History -->
      <div class="left-section">
        <!-- Profile -->
        <div class="profile-section">
          <n-flex align="center" :wrap="false" style="gap: 10px">
            <div class="avatar-wrapper">
              <n-image
                width="40"
                :src="assetPrefix + '/champion/' + sessionSummoner.championId"
                preview-disabled
                :fallback-src="nullImg"
                class="champion-img"
              />
              <div class="level-badge">{{ sessionSummoner?.summoner.summonerLevel }}</div>
            </div>

            <div class="info-wrapper">
              <n-flex align="center" style="gap: 4px">
                <n-button
                  text
                  @click="
                    searchSummoner(
                      sessionSummoner?.summoner.gameName + '#' + sessionSummoner?.summoner.tagLine
                    )
                  "
                >
                  <n-ellipsis style="max-width: 110px; font-size: 13px; font-weight: 700">
                    {{ sessionSummoner?.summoner.gameName }}
                  </n-ellipsis>
                </n-button>
                <n-button
                  text
                  size="tiny"
                  class="copy-btn"
                  @click="
                    copy(sessionSummoner.summoner.gameName + '#' + sessionSummoner.summoner.tagLine)
                  "
                >
                  <n-icon><copy-outline /></n-icon>
                </n-button>
              </n-flex>

              <n-flex align="center" style="gap: 6px; flex-wrap: wrap">
                <span class="tag-line">#{{ sessionSummoner?.summoner.tagLine }}</span>
                <n-flex align="center" style="gap: 4px">
                  <img class="tier-icon" :src="imgUrl" />
                  <span class="tier-text">{{ tierCn }}</span>
                </n-flex>
                <!-- ARAM Balance Status -->
                <n-popover
                  v-if="balanceTags.length > 0 && isAramMode"
                  trigger="hover"
                  style="padding: 5px"
                >
                  <template #trigger>
                    <n-tag
                      size="small"
                      :type="overallBalanceStatus.type"
                      :bordered="false"
                      round
                      style="height: 18px; padding: 0 6px; font-size: 11px; cursor: help"
                    >
                      {{ overallBalanceStatus.label }}
                    </n-tag>
                  </template>
                  <n-flex vertical size="small" style="gap: 4px">
                    <n-tag
                      v-for="tag in balanceTags"
                      :key="tag.label"
                      size="small"
                      :type="tag.type"
                      :bordered="false"
                    >
                      {{ tag.label }}
                    </n-tag>
                  </n-flex>
                </n-popover>
              </n-flex>
            </div>

            <div class="profile-tags">
              <n-tag
                v-if="sessionSummoner.preGroupMarkers?.name"
                size="small"
                :type="sessionSummoner.preGroupMarkers.type as any"
              >
                {{ sessionSummoner.preGroupMarkers.name }}
              </n-tag>
              <n-tag v-if="sessionSummoner.meetGames?.length > 0" type="warning" size="small" round>
                <n-popover trigger="hover">
                  <template #trigger>遇见过</template>
                  <MettingPlayersCard :meet-games="sessionSummoner.meetGames"></MettingPlayersCard>
                </n-popover>
              </n-tag>
              <n-tooltip
                v-for="tag in sessionSummoner?.userTag.tag"
                :key="tag.tagName"
                trigger="hover"
              >
                <template #trigger>
                  <n-tag size="small" :type="tag.good ? 'success' : 'error'" :bordered="false">
                    {{ tag.tagName }}
                  </n-tag>
                </template>
                <span>{{ tag.tagDesc }}</span>
              </n-tooltip>
            </div>
          </n-flex>
        </div>

        <!-- Match History Grid -->
        <PlayerHistoryGrid :games="sessionSummoner?.matchHistory.games.games" />
      </div>

      <!-- Right Side: Stats -->
      <div class="right-section">
        <PlayerStatsCard :recent="sessionSummoner.userTag.recentData" :is-dark="isDark" />
      </div>
    </n-flex>
  </n-card>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import {
  NCard,
  NFlex,
  NAvatar,
  NImage,
  NButton,
  NIcon,
  NEllipsis,
  NPopover,
  NTag,
  NTooltip
} from 'naive-ui'
import { CopyOutline } from '@vicons/ionicons5'
import MettingPlayersCard from './MettingPlayersCard.vue'
import { useCopy } from '@renderer/composables/useCopy'
import { searchSummoner } from '@renderer/utils/navigation'
import type { SessionSummoner } from '@renderer/types/domain/gaming'
import nullImg from '@renderer/assets/imgs/item/null.png'
import { assetPrefix } from '@renderer/services/http'
import { useSettingsStore } from '@renderer/pinia/setting'
import { useAramBalance } from '@renderer/composables/useAramBalance'
import PlayerHistoryGrid from './PlayerHistoryGrid.vue'
import PlayerStatsCard from './PlayerStatsCard.vue'

interface Props {
  sessionSummoner: SessionSummoner
  typeCn: string
  modeType: string
  imgUrl: string
  tierCn: string
  queueId: number
  team?: 'blue' | 'red'
}

const props = withDefaults(defineProps<Props>(), { team: undefined })

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

const { copy } = useCopy()

/** 只返回英雄 id 但无有效 summoner 信息 → 后端约定为隐藏战绩 */
const isHiddenRecord = computed(
  () =>
    !!props.sessionSummoner.championId &&
    (!props.sessionSummoner.summoner?.gameName || !props.sessionSummoner.summoner?.puuid)
)

const { isAramMode, balanceTags, overallBalanceStatus } = useAramBalance(
  toRef(() => props.sessionSummoner.championId),
  toRef(() => props.queueId)
)
</script>

<style lang="css" scoped>
.player-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  background: var(--glass-bg-mid) !important;
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--shadow-md), var(--glass-highlight) !important;
  transition: box-shadow var(--dur-normal) var(--ease-expo);
  animation: fade-up var(--dur-normal) var(--ease-expo) both;
  animation-delay: calc(var(--stagger) * var(--stagger-i, 0));
}

.player-card:hover {
  box-shadow: var(--shadow-lg), var(--glass-highlight) !important;
}

.player-card-team-blue {
  border-left: 2px solid var(--team-blue);
  border-color: var(--border-subtle);
  border-left-color: rgba(59, 130, 246, 0.6);
}

.player-card-team-red {
  border-left: 2px solid var(--team-red);
  border-color: var(--border-subtle);
  border-left-color: rgba(239, 68, 68, 0.6);
}

.light-mode-strip {
  border-left: 4px solid var(--text-tertiary);
}

.loading-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.hidden-record-block {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.hidden-record-inner {
  gap: var(--space-8);
}

.hidden-record-avatar {
  border: 2px solid var(--border-subtle);
}

.hidden-record-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.left-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.right-section {
  width: 100px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-left: 8px;
}

.profile-section {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--n-divider-color);
}

.avatar-wrapper {
  position: relative;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.champion-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-sm);
  display: block;
}

.level-badge {
  position: absolute;
  bottom: -6px;
  right: -6px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.7);
  padding: 0 4px;
  border-radius: var(--radius-sm);
  color: white;
  line-height: 14px;
}

.info-wrapper {
  flex: 0 1 auto;
  min-width: 0;
}

.profile-tags {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  align-items: center;
  padding-left: 8px;
}

.copy-btn {
  opacity: 0.6;
  transition: opacity 0.2s;
}

.copy-btn:hover {
  opacity: 1;
}

.tag-line {
  color: var(--n-text-color-3);
  font-size: 12px;
}

.tier-icon {
  width: 16px;
  height: 16px;
}

.tier-text {
  font-size: 12px;
  color: var(--n-text-color-2);
}

.custom-spin {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--semantic-win);
  animation: player-spin 1s linear infinite;
  flex-shrink: 0;
}

@keyframes player-spin {
  to {
    transform: rotate(360deg);
  }
}

:deep(.n-tag--success-type) {
  background: rgba(61, 155, 122, 0.12) !important;
  color: var(--semantic-win) !important;
  border: 1px solid rgba(61, 155, 122, 0.2) !important;
}

:deep(.n-tag--error-type) {
  background: rgba(196, 92, 92, 0.1) !important;
  color: var(--semantic-loss) !important;
  border: 1px solid rgba(196, 92, 92, 0.18) !important;
}

:deep(.n-tag--warning-type) {
  background: rgba(251, 191, 36, 0.1) !important;
  color: #d97706 !important;
  border: 1px solid rgba(251, 191, 36, 0.2) !important;
}
</style>
