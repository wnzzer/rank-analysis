<template>
  <n-card
    class="player-card"
    :class="{ 'light-mode-strip': settingsStore.theme?.name === 'Light' }"
    size="small"
    :bordered="true"
    content-style="padding: 8px;"
  >
    <div
      v-if="sessionSummoner.isLoading"
      class="loading-container"
      style="
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 8px;
      "
    >
      <n-spin size="medium" />
      <span v-if="sessionSummoner.summoner.gameName" style="font-size: 12px; color: #aaa">
        {{ sessionSummoner.summoner.gameName }}
      </span>
    </div>
    <div v-else-if="!sessionSummoner.summoner.gameName" class="loading-container">
      <n-spin size="small" />
    </div>

    <n-flex v-else style="height: 100%" :wrap="false">
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

              <n-flex align="center" style="gap: 6px">
                <span class="tag-line">#{{ sessionSummoner?.summoner.tagLine }}</span>
                <n-flex align="center" style="gap: 4px">
                  <img class="tier-icon" :src="imgUrl" />
                  <span class="tier-text">{{ tierCn }}</span>
                </n-flex>
                <!-- ARAM Balance Tags -->
                <n-popover
                  trigger="hover"
                  v-if="balanceTags.length > 0 && isAramMode"
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
          </n-flex>
        </div>

        <!-- Match History Grid -->
        <div class="history-grid">
          <div
            v-for="(game, index) in sessionSummoner?.matchHistory.games.games"
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
              />
              <div class="kda-text">
                <span class="kill">{{ game.participants[0].stats?.kills }}</span
                >/ <span class="death">{{ game.participants[0].stats?.deaths }}</span
                >/
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
      </div>

      <!-- Right Side: Tags & Stats -->
      <div class="right-section">
        <!-- Tags -->
        <div class="tags-container">
          <n-flex size="small" style="gap: 4px; flex-wrap: wrap; justify-content: flex-end">
            <n-tag
              v-if="sessionSummoner.preGroupMarkers?.name"
              size="small"
              :type="sessionSummoner.preGroupMarkers.type"
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
              trigger="hover"
              v-for="tag in sessionSummoner?.userTag.tag"
              :key="tag.tagName"
            >
              <template #trigger>
                <n-tag size="small" :type="tag.good ? 'success' : 'error'" :bordered="false">
                  {{ tag.tagName }}
                </n-tag>
              </template>
              <span>{{ tag.tagDesc }}</span>
            </n-tooltip>

            <!-- ARAM Balance Tags -->
          </n-flex>
        </div>

        <!-- Collapsible Stats Card -->
        <div class="stats-container">
          <div class="stats-card" :class="{ 'is-expanded': showStats }">
            <!-- Header / Toggle -->
            <div class="stats-header" @click="showStats = !showStats">
              <span class="stats-title">近期数据</span>
              <n-icon size="14" class="toggle-icon">
                <chevron-down v-if="!showStats" />
                <chevron-up v-else />
              </n-icon>
            </div>

            <!-- Compact Content (Always Visible in Compact Mode) -->
            <div v-if="!showStats" class="stats-compact" @click="showStats = true">
              <div class="compact-row">
                <span class="label">模式</span>
                <span class="value">{{ sessionSummoner?.userTag.recentData.selectModeCn }}</span>
              </div>
              <div class="compact-row">
                <span class="label">KDA</span>
                <span
                  class="value"
                  :style="{ color: kdaColor(sessionSummoner?.userTag.recentData.kda) }"
                >
                  {{ sessionSummoner?.userTag.recentData.kda }}
                </span>
              </div>
              <div class="compact-row">
                <span class="label">胜率</span>
                <span
                  class="value"
                  :style="{
                    color: winRateColor(
                      winRate(
                        sessionSummoner?.userTag.recentData.wins,
                        sessionSummoner?.userTag.recentData.losses
                      )
                    )
                  }"
                >
                  {{
                    winRate(
                      sessionSummoner?.userTag.recentData.selectWins,
                      sessionSummoner?.userTag.recentData.selectLosses
                    )
                  }}%
                </span>
              </div>
            </div>

            <!-- Expanded Content -->
            <div v-else class="stats-full">
              <!-- Mode -->
              <div class="stats-row">
                <span class="label">模式</span>
                <span class="value" style="font-weight: 600">{{
                  sessionSummoner?.userTag.recentData.selectModeCn
                }}</span>
              </div>
              <!-- KDA -->
              <div class="stats-row">
                <span class="label">KDA</span>
                <div class="value-group">
                  <span
                    :style="{ color: kdaColor(sessionSummoner?.userTag.recentData.kda) }"
                    style="font-weight: bold; margin-right: 4px"
                  >
                    {{ sessionSummoner?.userTag.recentData.kda }}
                  </span>
                  <span class="kda-detail">
                    <span
                      :style="{ color: killsColor(sessionSummoner?.userTag.recentData.kills) }"
                      >{{ sessionSummoner?.userTag.recentData.kills }}</span
                    >/
                    <span
                      :style="{ color: deathsColor(sessionSummoner?.userTag.recentData.deaths) }"
                      >{{ sessionSummoner?.userTag.recentData.deaths }}</span
                    >/
                    <span
                      :style="{ color: assistsColor(sessionSummoner?.userTag.recentData.assists) }"
                      >{{ sessionSummoner?.userTag.recentData.assists }}</span
                    >
                  </span>
                </div>
              </div>
              <!-- Win Rate -->
              <div class="stats-row">
                <span class="label">胜率</span>
                <div class="progress-wrapper">
                  <n-progress
                    type="line"
                    :percentage="
                      winRate(
                        sessionSummoner?.userTag.recentData.selectWins,
                        sessionSummoner?.userTag.recentData.selectLosses
                      )
                    "
                    :height="6"
                    :show-indicator="false"
                    :color="
                      winRateColor(
                        winRate(
                          sessionSummoner?.userTag.recentData.wins,
                          sessionSummoner?.userTag.recentData.losses
                        )
                      )
                    "
                    processing
                  />
                  <span
                    class="progress-text"
                    :style="{
                      color: winRateColor(
                        winRate(
                          sessionSummoner?.userTag.recentData.selectWins,
                          sessionSummoner?.userTag.recentData.selectLosses
                        )
                      )
                    }"
                  >
                    {{
                      winRate(
                        sessionSummoner?.userTag.recentData.selectWins,
                        sessionSummoner?.userTag.recentData.selectLosses
                      )
                    }}%
                  </span>
                </div>
              </div>
              <!-- Group Rate -->
              <div class="stats-row">
                <span class="label">参团</span>
                <div class="progress-wrapper">
                  <n-progress
                    type="line"
                    :percentage="sessionSummoner?.userTag.recentData.groupRate"
                    :height="6"
                    :show-indicator="false"
                    :color="groupRateColor(sessionSummoner?.userTag.recentData.groupRate)"
                    processing
                  />
                  <span
                    class="progress-text"
                    :style="{
                      color: groupRateColor(sessionSummoner?.userTag.recentData.groupRate)
                    }"
                  >
                    {{ sessionSummoner?.userTag.recentData.groupRate }}%
                  </span>
                </div>
              </div>
              <!-- Damage -->
              <div class="stats-row">
                <span class="label">伤害</span>
                <div class="progress-wrapper">
                  <n-progress
                    type="line"
                    :percentage="sessionSummoner?.userTag.recentData.damageDealtToChampionsRate"
                    :color="
                      otherColor(sessionSummoner?.userTag.recentData.damageDealtToChampionsRate)
                    "
                    :height="6"
                    :show-indicator="false"
                    processing
                  />
                  <span
                    class="progress-text"
                    :style="{
                      color: otherColor(
                        sessionSummoner?.userTag.recentData.damageDealtToChampionsRate
                      )
                    }"
                  >
                    {{ sessionSummoner?.userTag.recentData.damageDealtToChampionsRate }}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </n-flex>
  </n-card>
</template>
<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import MettingPlayersCard from './MettingPlayersCard.vue'
import { useCopy } from '../composition'
import { searchSummoner, winRate } from '../record/composition'
import {
  kdaColor,
  killsColor,
  deathsColor,
  assistsColor,
  otherColor,
  winRateColor,
  groupRateColor
} from '../record/composition'
import { SessionSummoner } from '../../components/gaming/type'
import nullImg from '../../assets/imgs/item/null.png'
import { CopyOutline, ChevronDown, ChevronUp } from '@vicons/ionicons5'
import { assetPrefix } from '../../services/http'
import { useSettingsStore } from '../../pinia/setting'

const settingsStore = useSettingsStore()
const copy = useCopy().copy
const showStats = ref(false)
const props = defineProps<{
  sessionSummoner: SessionSummoner
  typeCn: string
  modeType: string
  imgUrl: string
  tierCn: string
  queueId: number
}>()

interface AramBalanceData {
  dmg_dealt?: number
  dmg_taken?: number
  healing?: number
  shielding?: number
  ability_haste?: number
  mana_regen?: number
  energy_regen?: number
  attack_speed?: number
  movement_speed?: number
  tenacity?: number
}

const aramBalance = ref<AramBalanceData | null>(null)

const isAramMode = computed(() => {
  return props.queueId === 450 || props.queueId === 2400 // 450: ARAM, 2400: Hextech ARAM
})

const fetchAramBalance = async () => {
  if (props.sessionSummoner.championId && isAramMode.value) {
    try {
      const data = await invoke<AramBalanceData | null>('get_aram_balance', {
        id: props.sessionSummoner.championId
      })
      aramBalance.value = data
    } catch (e) {
      console.error('Failed to fetch aram balance', e)
    }
  }
}

watch(
  () => props.sessionSummoner.championId,
  () => {
    fetchAramBalance()
  }
)

watch(
  () => isAramMode.value,
  () => {
    fetchAramBalance()
  }
)

onMounted(() => {
  fetchAramBalance()
})

interface BalanceTag {
  label: string
  desc: string
  type: 'success' | 'error'
  isBuff: boolean
}

const balanceTags = computed<BalanceTag[]>(() => {
  if (!aramBalance.value) return []

  const tags: BalanceTag[] = []
  const b = aramBalance.value

  const formatPct = (val: number) => {
    const diff = val - 1
    return (diff > 0 ? '+' : '') + Math.round(diff * 100) + '%'
  }

  // Only show: Damage Dealt, Damage Taken, Healing, Shielding, Ability Haste
  // And exclude values that are essentially 1.0 (or 0 for haste)

  if (typeof b.dmg_dealt === 'number' && Math.abs(b.dmg_dealt - 1.0) > 0.001) {
    tags.push({
      label: `输出 ${formatPct(b.dmg_dealt)}`,
      desc: '造成伤害修正',
      type: b.dmg_dealt > 1.0 ? 'success' : 'error',
      isBuff: b.dmg_dealt > 1.0
    })
  }
  if (typeof b.dmg_taken === 'number' && Math.abs(b.dmg_taken - 1.0) > 0.001) {
    tags.push({
      label: `承伤 ${formatPct(b.dmg_taken)}`,
      desc: '承受伤害修正',
      type: b.dmg_taken < 1.0 ? 'success' : 'error',
      isBuff: b.dmg_taken < 1.0
    })
  }
  if (typeof b.healing === 'number' && Math.abs(b.healing - 1.0) > 0.001) {
    tags.push({
      label: `治疗 ${formatPct(b.healing)}`,
      desc: '治疗效果修正',
      type: b.healing > 1 ? 'success' : 'error',
      isBuff: b.healing > 1.0
    })
  }
  if (typeof b.shielding === 'number' && Math.abs(b.shielding - 1.0) > 0.001) {
    tags.push({
      label: `护盾 ${formatPct(b.shielding)}`,
      desc: '护盾效果修正',
      type: b.shielding > 1 ? 'success' : 'error',
      isBuff: b.shielding > 1.0
    })
  }
  if (typeof b.ability_haste === 'number' && b.ability_haste !== 0) {
    tags.push({
      label: `急速 ${b.ability_haste > 0 ? '+' : ''}${b.ability_haste}`,
      desc: '技能急速修正',
      type: b.ability_haste > 0 ? 'success' : 'error',
      isBuff: b.ability_haste > 0
    })
  }
  // Filtered out: Mana, Energy, AS, MS, Tenacity

  return tags
})

const overallBalanceStatus = computed(() => {
  const tags = balanceTags.value
  if (tags.length === 0) {
    return { label: '平衡', type: 'default' }
  }

  let buffCount = 0
  let nerfCount = 0

  for (const tag of tags) {
    if (tag.isBuff) buffCount++
    else nerfCount++
  }

  if (buffCount > nerfCount) {
    return { label: '增强', type: 'success' }
  } else if (nerfCount > buffCount) {
    return { label: '削弱', type: 'error' }
  } else {
    return { label: '调整', type: 'warning' }
  }
})
</script>
<style lang="css" scoped>
.player-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.light-mode-strip {
  border-left: 4px solid #666;
}

.loading-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
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
  border-radius: 4px;
  display: block;
}

.level-badge {
  position: absolute;
  bottom: -6px;
  right: -6px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.7);
  padding: 0 4px;
  border-radius: 4px;
  color: white;
  line-height: 14px;
}

.info-wrapper {
  flex: 1;
  min-width: 0;
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

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 4px;
  flex: 1;
  overflow-y: auto;
}

.history-item {
  background: var(--n-action-color);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  border-left: 3px solid #ba3f53;
}

.history-item.is-win {
  border-left: 3px solid #8bdfb7;
}

.win-status {
  font-weight: 600;
  color: #ba3f53;
  width: 20px;
}

.win-status.is-win {
  color: #8bdfb7;
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
}

.kill {
  color: #8bdfb7;
}

.death {
  color: #ba3f53;
}

.assist {
  color: #d38b2a;
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

.tags-container {
  min-height: 24px;
}

.stats-container {
  position: relative;
}

.stats-card {
  background: var(--n-action-color);
  border-radius: 6px;
  padding: 6px;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.stats-card.is-expanded {
  position: absolute;
  top: 0;
  right: 0;
  width: 240px;
  z-index: 100;
  background: var(--n-color);
  border-color: var(--n-primary-color);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--n-divider-color);
}

.stats-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--n-text-color-2);
}

.toggle-icon {
  opacity: 0.7;
}

.stats-compact {
  cursor: pointer;
}

.compact-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  margin-bottom: 2px;
}

.stats-full {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.label {
  color: var(--n-text-color-3);
}

.value-group {
  display: flex;
  align-items: center;
}

.kda-detail {
  font-size: 11px;
  opacity: 0.9;
  margin-left: 4px;
}

.progress-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: flex-end;
  margin-left: 8px;
}

.progress-wrapper .n-progress {
  flex: 1;
  max-width: 120px;
}

.progress-text {
  font-size: 11px;
  min-width: 35px;
  text-align: right;
}
</style>
