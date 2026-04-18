<template>
  <div v-if="game && mySummary" class="match-detail-page">
    <div class="match-detail-modal">
      <div class="match-detail-shell">
        <!-- Header -->
        <div class="match-detail-header">
          <div>
            <div class="match-detail-title-row">
              <n-tag size="small" :bordered="false" :type="mySummary.win ? 'success' : 'error'">
                {{ mySummary.win ? '胜利' : '失败' }}
              </n-tag>
              <span class="match-detail-queue">{{ game.queueName }}</span>
              <span class="match-detail-meta">{{ formattedDate }} · {{ durationLabel }}</span>
            </div>
            <div class="match-detail-player-row">
              <img
                class="match-detail-hero"
                :src="assetPrefix + '/champion/' + mySummary.championId"
                alt="champion"
                decoding="async"
              />
              <div class="match-detail-player-copy">
                <div class="match-detail-player-name">{{ mySummary.displayName }}</div>
                <div class="match-detail-player-kda">
                  <span class="font-number" :style="{ color: killsColor(mySummary.stats.kills, isDark) }">{{ mySummary.stats.kills }}</span>
                  <span>/</span>
                  <span class="font-number" :style="{ color: deathsColor(mySummary.stats.deaths, isDark) }">{{ mySummary.stats.deaths }}</span>
                  <span>/</span>
                  <span class="font-number" :style="{ color: assistsColor(mySummary.stats.assists, isDark) }">{{ mySummary.stats.assists }}</span>
                  <span class="font-number match-detail-kda-ratio" :style="{ color: kdaColor(kdaRatio(mySummary.stats), isDark) }">
                    {{ kdaRatioLabel(mySummary.stats) }}
                  </span>
                  <span class="match-detail-meta">{{ formatCompactNumber(mySummary.stats.goldEarned) }} 金币</span>
                  <span class="match-detail-meta">{{ totalCs(mySummary.stats) }} 补兵</span>
                </div>
              </div>
            </div>
          </div>

          <div class="match-detail-summary-side">
            <div class="match-detail-summary-grid">
              <div class="match-detail-summary-card">
                <div class="match-detail-summary-label">输出</div>
                <div class="match-detail-summary-value font-number">
                  {{ formatCompactNumber(mySummary.stats.totalDamageDealtToChampions) }}
                </div>
              </div>
              <div class="match-detail-summary-card">
                <div class="match-detail-summary-label">承伤</div>
                <div class="match-detail-summary-value font-number">
                  {{ formatCompactNumber(mySummary.stats.totalDamageTaken) }}
                </div>
              </div>
              <div class="match-detail-summary-card">
                <div class="match-detail-summary-label">推塔</div>
                <div class="match-detail-summary-value font-number">
                  {{ formatCompactNumber(mySummary.stats.damageDealtToTurrets) }}
                </div>
              </div>
            </div>

            <div class="match-detail-ai-toolbar">
              <div class="match-detail-ai-copy">
                <span class="match-detail-ai-title">AI 复盘</span>
                <span class="match-detail-ai-subtitle">整局归因 + 单人责任分析</span>
              </div>
              <n-button size="small" secondary type="info" :loading="ai.aiLoading.value" @click="onOverview">
                <template #icon>
                  <n-icon><SparklesOutline /></n-icon>
                </template>
                整局分析
              </n-button>
            </div>
          </div>
        </div>

        <!-- Team Sections -->
        <div class="match-detail-body">
          <section v-for="team in teamSections" :key="team.teamId" class="match-detail-team-section">
            <div class="match-detail-team-header" :class="team.headerClass">
              <div class="match-detail-team-title-wrap">
                <span class="match-detail-team-title">{{ team.title }}</span>
                <span class="match-detail-team-subtitle">
                  {{ team.kills }}/{{ team.deaths }}/{{ team.assists }} ·
                  {{ formatCompactNumber(team.gold) }} 金币
                </span>
              </div>
              <div class="match-detail-team-subtitle">
                输出 {{ formatCompactNumber(team.damage) }} · 承伤 {{ formatCompactNumber(team.taken) }}
              </div>
            </div>

            <div class="match-detail-column-header">
              <span>玩家</span>
              <span>装备 / 技能 / {{ usesAugments ? '海克斯' : '符文' }}</span>
              <span>KDA</span>
              <span>金钱</span>
              <span>补兵</span>
              <span>推塔</span>
              <span></span>
            </div>

            <div class="match-detail-team-rows">
              <div
                v-for="player in team.players"
                :key="player.participantId"
                class="match-detail-row"
                :class="{ 'match-detail-row-me': player.isMe }"
              >
                <div class="match-detail-player-cell">
                  <div class="match-detail-player-main">
                    <img
                      class="match-detail-player-avatar"
                      :src="assetPrefix + '/champion/' + player.championId"
                      alt="champion"
                      loading="lazy"
                      decoding="async"
                    />
                    <div class="match-detail-player-text">
                      <div class="match-detail-player-text-row">
                        <span class="match-detail-player-display">{{ player.displayName }}</span>
                        <n-button
                          text
                          size="tiny"
                          class="match-detail-player-copy"
                          @click.stop="copy(player.displayName)"
                        >
                          <template #icon>
                            <n-icon><CopyOutline /></n-icon>
                          </template>
                        </n-button>
                        <n-tag v-if="player.isMe" size="small" :bordered="false" type="info">我</n-tag>
                        <n-button
                          quaternary
                          size="tiny"
                          class="match-detail-player-ai-trigger"
                          :loading="ai.aiLoading.value && ai.aiMode.value === 'player' && ai.aiTargetParticipantId.value === player.participantId"
                          @click.stop="ai.openPlayerAnalysis(player.participantId)"
                        >
                          <template #icon>
                            <n-icon><SparklesOutline /></n-icon>
                          </template>
                          分析
                        </n-button>
                      </div>
                      <div class="match-detail-badge-row">
                        <n-tooltip v-for="badge in player.badges" :key="badge.key" trigger="hover" placement="top">
                          <template #trigger>
                            <span class="match-detail-badge-icon" :class="badge.className">
                              <n-icon :size="10">
                                <component :is="badge.icon" />
                              </n-icon>
                            </span>
                          </template>
                          {{ badge.label }}
                        </n-tooltip>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="match-detail-build-cell">
                  <div class="match-detail-build-topline">
                    <div class="match-detail-spells">
                      <n-tooltip
                        v-for="(spellId, index) in [player.spell1Id, player.spell2Id]"
                        :key="`${player.participantId}-spell-${spellId}-${index}`"
                        trigger="hover"
                        placement="top"
                        :disabled="!assets.detailOf('spell', spellId)"
                      >
                        <template #trigger>
                          <img
                            :src="assets.srcOf('spell', spellId)"
                            class="match-detail-spell-icon"
                            alt="spell"
                            loading="lazy"
                            decoding="async"
                          />
                        </template>
                        <AssetTooltipContent
                          v-if="assets.detailOf('spell', spellId)"
                          :icon-src="assets.srcOf('spell', spellId)"
                          :name="assets.detailOf('spell', spellId)?.name ?? ''"
                          :description="assets.detailOf('spell', spellId)?.description ?? ''"
                        />
                      </n-tooltip>
                    </div>
                    <div class="match-detail-perks">
                      <n-tooltip
                        v-for="(perkId, index) in displayedPerkIds(player.stats)"
                        :key="`${player.participantId}-perk-${perkId}-${index}`"
                        trigger="hover"
                        placement="top"
                        :disabled="!usesAugments && !assets.detailOf('perk', perkId)"
                      >
                        <template #trigger>
                          <span
                            v-if="usesAugments"
                            :class="['match-detail-augment-icon-shell', augmentRarityClass(assets.detailOf('perk', perkId)?.rarity, 'match-detail-augment')]"
                          >
                            <img
                              :src="assets.srcOf('perk', perkId)"
                              class="match-detail-augment-icon"
                              alt="augment"
                              loading="lazy"
                              decoding="async"
                            />
                          </span>
                          <img
                            v-else
                            :src="assets.srcOf('perk', perkId)"
                            :class="['match-detail-perk-icon', { 'match-detail-perk-icon-sub': index === 1 }]"
                            alt="perk"
                            loading="lazy"
                            decoding="async"
                          />
                        </template>
                        <AssetTooltipContent
                          :icon-src="assets.srcOf('perk', perkId)"
                          :name="
                            assets.detailOf('perk', perkId)?.name ??
                            (usesAugments ? `海克斯 #${perkId}` : `符文 #${perkId}`)
                          "
                          :description="
                            assets.detailOf('perk', perkId)?.description ?? '资源加载中…'
                          "
                        />
                      </n-tooltip>
                    </div>
                  </div>
                  <div class="match-detail-items">
                    <n-tooltip
                      v-for="(itemId, index) in itemIds(player.stats)"
                      :key="`${player.participantId}-${index}`"
                      trigger="hover"
                      placement="top"
                      :disabled="!assets.detailOf('item', itemId)"
                    >
                      <template #trigger>
                        <img
                          :src="assets.srcOf('item', itemId)"
                          class="match-detail-item-icon"
                          alt="item"
                          loading="lazy"
                          decoding="async"
                        />
                      </template>
                      <AssetTooltipContent
                        v-if="assets.detailOf('item', itemId)"
                        :icon-src="assets.srcOf('item', itemId)"
                        :name="assets.detailOf('item', itemId)?.name ?? ''"
                        :description="assets.detailOf('item', itemId)?.description ?? ''"
                      />
                    </n-tooltip>
                  </div>
                </div>

                <div class="match-detail-value-cell font-number match-detail-kda-value-cell">
                  <span :style="{ color: killsColor(player.stats.kills, isDark) }">{{ player.stats.kills }}</span>
                  <span class="match-detail-kda-separator">/</span>
                  <span :style="{ color: deathsColor(player.stats.deaths, isDark) }">{{ player.stats.deaths }}</span>
                  <span class="match-detail-kda-separator">/</span>
                  <span :style="{ color: assistsColor(player.stats.assists, isDark) }">{{ player.stats.assists }}</span>
                </div>
                <div class="match-detail-value-cell font-number">
                  {{ formatCompactNumber(player.stats.goldEarned) }}
                </div>
                <div class="match-detail-value-cell font-number">{{ totalCs(player.stats) }}</div>
                <div class="match-detail-value-cell font-number">
                  {{ formatCompactNumber(player.stats.damageDealtToTurrets) }}
                </div>

                <div class="match-detail-dots-cell">
                  <StatDots
                    :icon="FlameOutline"
                    tooltip="对英雄伤害，占己方总和百分比"
                    :color="otherColor(player.teamRelative.damage, isDark)"
                    :icon-background="isDark ? 'rgba(229, 167, 50, 0.18)' : 'rgba(229, 167, 50, 0.14)'"
                    :value="formatCompactNumber(player.stats.totalDamageDealtToChampions)"
                    :percent="player.teamRelative.damage"
                    compact
                  />
                  <StatDots
                    :icon="ShieldOutline"
                    tooltip="承受伤害，占己方总和百分比"
                    :color="healColorAndTaken(player.teamRelative.taken, isDark)"
                    :icon-background="isDark ? 'rgba(92, 163, 234, 0.2)' : 'rgba(92, 163, 234, 0.12)'"
                    :value="formatCompactNumber(player.stats.totalDamageTaken)"
                    :percent="player.teamRelative.taken"
                    compact
                  />
                  <StatDots
                    :icon="HeartOutline"
                    tooltip="治疗量，占己方总和百分比"
                    :color="healColorAndTaken(player.teamRelative.heal, isDark)"
                    :icon-background="isDark ? 'rgba(88, 182, 109, 0.2)' : 'rgba(88, 182, 109, 0.14)'"
                    :value="formatCompactNumber(player.stats.totalHeal)"
                    :percent="player.teamRelative.heal"
                    compact
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <MatchAIPanel
      :show="ai.showAiModal.value"
      :mode="ai.aiMode.value"
      :target-participant-id="ai.aiTargetParticipantId.value"
      :loading="ai.aiLoading.value"
      :rendered-result="ai.renderedAiResult.value"
      :player-options="aiPlayerOptions"
      @update:show="ai.showAiModal.value = $event"
      @update:mode="ai.aiMode.value = $event"
      @update:target-participant-id="ai.aiTargetParticipantId.value = $event"
      @rerun="ai.runCurrentAiAnalysis"
    />
  </div>
  <div v-else class="match-detail-empty-state">
    <span class="match-detail-empty-title">暂无对局详情</span>
    <span class="match-detail-empty-copy">回到战绩页重新打开一场对局即可。</span>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch, onMounted, toRef } from 'vue'
import {
  CopyOutline,
  FlameOutline,
  HeartOutline,
  ShieldOutline,
  SparklesOutline
} from '@vicons/ionicons5'
import { NButton, NIcon, NTag, NTooltip } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { useCopy } from '@renderer/composables/useCopy'

import { useSettingsStore } from '@renderer/pinia/setting'
import { assetPrefix } from '@renderer/services/http'
import type { Game, ParticipantStats } from '@renderer/types/domain/match'
import type { Summoner } from '@renderer/types/domain/player'
import AssetTooltipContent from './AssetTooltipContent.vue'
import StatDots from './StatDots.vue'
import MatchAIPanel from './MatchAIPanel.vue'
import {
  assistsColor,
  deathsColor,
  healColorAndTaken,
  kdaColor,
  killsColor,
  otherColor
} from '@renderer/utils/colors'
import { formatCompactNumber } from '@renderer/utils/format'
import { augmentRarityClass } from '@renderer/utils/augment'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { useMatchDetailPlayers } from '@renderer/composables/useMatchDetailPlayers'
import { useMatchAIAnalysis } from '@renderer/composables/useMatchAIAnalysis'

const props = defineProps<{ game: Game | null }>()

const settingsStore = useSettingsStore()
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

const currentSummoner = ref<Summoner | null>(null)

/** 优先使用当前登录用户匹配"我"，未获取到则回退到 game 的第一个参与者 */
const currentPlayerKey = computed(() => {
  if (currentSummoner.value) {
    return `${currentSummoner.value.gameName}#${currentSummoner.value.tagLine}`
  }
  const identity = props.game?.participantIdentities?.[0]?.player
  if (!identity) return ''
  return `${identity.gameName}#${identity.tagLine}`
})

const gameRef = toRef(() => props.game)
const { detailPlayers, mySummary, teamSections } = useMatchDetailPlayers(gameRef, currentPlayerKey)
const ai = useMatchAIAnalysis(gameRef)
const assets = useRecordAssets()
const { copy } = useCopy()

function totalCs(stats: ParticipantStats) {
  return stats.totalMinionsKilled + stats.neutralMinionsKilled
}
function kdaRatio(stats: ParticipantStats) {
  return (stats.kills + stats.assists) / Math.max(1, stats.deaths)
}
function kdaRatioLabel(stats: ParticipantStats) {
  return `${kdaRatio(stats).toFixed(1)} KDA`
}
function itemIds(stats: ParticipantStats) {
  return [stats.item0, stats.item1, stats.item2, stats.item3, stats.item4, stats.item5, stats.item6]
}
function playerAugmentIds(stats: ParticipantStats) {
  return [
    stats.playerAugment1,
    stats.playerAugment2,
    stats.playerAugment3,
    stats.playerAugment4
  ].filter(id => id > 0)
}
function displayedPerkIds(stats: ParticipantStats) {
  if (usesAugments.value) {
    const ids = playerAugmentIds(stats)
    if (ids.length > 0) return ids
  }
  return [stats.perk0, stats.perkSubStyle].filter(id => id > 0)
}

const formattedDate = computed(() => {
  if (!props.game) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(props.game.gameCreationDate))
})

const durationLabel = computed(() => {
  if (!props.game) return ''
  const minutes = Math.floor(props.game.gameDuration / 60)
  const seconds = props.game.gameDuration % 60
  return `${minutes}分${seconds.toString().padStart(2, '0')}秒`
})

const augmentQueueIds = new Set([1700, 2400])
const usesAugments = computed(() => {
  if (!props.game || !augmentQueueIds.has(props.game.queueId)) return false
  return detailPlayers.value.some(p => playerAugmentIds(p.stats).length > 0)
})

const aiPlayerOptions = computed(() =>
  detailPlayers.value.map(p => ({ label: p.displayName, value: p.participantId }))
)

function onOverview() {
  ai.openOverviewAnalysis(mySummary.value?.participantId ?? detailPlayers.value[0]?.participantId ?? null)
}

function loadAssetsIfNeeded() {
  if (!props.game) return
  const itemIdsToLoad = new Set<number>()
  const perkIdsToLoad = new Set<number>()
  const spellIdsToLoad = new Set<number>()
  for (const player of detailPlayers.value) {
    for (const id of itemIds(player.stats)) if (id > 0) itemIdsToLoad.add(id)
    for (const id of displayedPerkIds(player.stats)) perkIdsToLoad.add(id)
    if (player.spell1Id > 0) spellIdsToLoad.add(player.spell1Id)
    if (player.spell2Id > 0) spellIdsToLoad.add(player.spell2Id)
  }
  assets.preload([
    { kind: 'item', ids: [...itemIdsToLoad] },
    { kind: 'perk', ids: [...perkIdsToLoad] },
    { kind: 'spell', ids: [...spellIdsToLoad] }
  ])
}

onMounted(async () => {
  try {
    currentSummoner.value = await invoke<Summoner>('get_my_summoner')
  } catch (error) {
    console.error('获取当前用户信息失败:', error)
  }
  loadAssetsIfNeeded()
})

watch(
  () => props.game?.gameId,
  () => {
    ai.resetOnGameChange(mySummary.value?.participantId ?? detailPlayers.value[0]?.participantId ?? null)
    loadAssetsIfNeeded()
  },
  { immediate: true }
)
</script>

<style scoped>
.match-detail-page {
  width: 100%;
  height: 100%;
  padding: 2px 3px 3px;
  box-sizing: border-box;
  background: var(--bg-base);
}

.match-detail-modal {
  width: 100%;
  height: 100%;
  max-height: none;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-sizing: border-box;
  color: var(--text-primary);
  background:
    radial-gradient(circle at top left, rgba(61, 155, 122, 0.14), transparent 28%),
    radial-gradient(circle at top right, rgba(92, 163, 234, 0.16), transparent 32%),
    var(--bg-base);
}

.match-detail-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.match-detail-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 6px;
  padding: 7px 10px 5px;
  border-bottom: 1px solid var(--border-subtle);
}

.match-detail-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 3px;
}

.match-detail-queue {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-meta {
  color: var(--text-secondary);
  font-size: 11px;
}

.match-detail-player-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.match-detail-hero {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
}

.match-detail-player-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.match-detail-player-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-player-kda {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-primary);
}

.match-detail-kda-ratio {
  margin-left: 3px;
  font-size: 11px;
  font-weight: 600;
}

.match-detail-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.match-detail-summary-side {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.match-detail-summary-card {
  padding: 5px 7px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.03);
}

.theme-light .match-detail-summary-card {
  background: rgba(255, 255, 255, 0.82);
}

.match-detail-summary-label {
  color: var(--text-secondary);
  font-size: 10px;
  margin-bottom: 4px;
}

.match-detail-summary-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-ai-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.theme-light .match-detail-ai-toolbar {
  background: rgba(255, 255, 255, 0.82);
}

.match-detail-ai-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.match-detail-ai-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-ai-subtitle {
  font-size: 11px;
  color: var(--text-secondary);
}

.match-detail-body {
  overflow: auto;
  padding: 4px 10px 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.match-detail-team-section {
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.06);
}

.theme-light .match-detail-team-section {
  background: rgba(255, 255, 255, 0.92);
}

.match-detail-team-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  color: #fff;
}

.match-detail-team-header-win {
  background: linear-gradient(90deg, rgba(45, 138, 108, 0.88), rgba(45, 138, 108, 0.52));
}

.match-detail-team-header-loss {
  background: linear-gradient(90deg, rgba(184, 66, 66, 0.88), rgba(184, 66, 66, 0.52));
}

.match-detail-team-title-wrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.match-detail-team-title {
  font-size: 14px;
  font-weight: 700;
}

.match-detail-team-subtitle {
  font-size: 11px;
  opacity: 0.95;
}

.match-detail-column-header,
.match-detail-row {
  display: grid;
  grid-template-columns: minmax(188px, 1.22fr) minmax(214px, 1.36fr) 72px 68px 62px 68px minmax(198px, 1.3fr);
  gap: 6px;
  align-items: center;
}

.match-detail-column-header {
  padding: 4px 9px;
  color: var(--text-secondary);
  font-size: 10px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid var(--border-subtle);
}

.theme-light .match-detail-column-header {
  background: rgba(0, 0, 0, 0.02);
}

.match-detail-team-rows {
  display: flex;
  flex-direction: column;
}

.match-detail-row {
  padding: 4px 9px;
  border-bottom: 1px solid var(--border-subtle);
}

.match-detail-row:last-child {
  border-bottom: none;
}

.match-detail-row-me {
  background: rgba(92, 163, 234, 0.08);
}

.theme-light .match-detail-row-me {
  background: rgba(92, 163, 234, 0.06);
}

.match-detail-player-main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.match-detail-player-avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.match-detail-player-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.match-detail-player-text-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.match-detail-player-display {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-detail-player-ai-trigger {
  --n-text-color: var(--text-secondary);
}

.match-detail-player-copy {
  --n-text-color: var(--text-tertiary);
  opacity: 0.6;
  transition: opacity var(--dur-fast) var(--ease-expo);
}

.match-detail-player-copy:hover {
  opacity: 1;
}

.match-detail-badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.match-detail-player-text-row :deep(.n-tag) {
  color: var(--text-primary);
}

.match-detail-badge-icon {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.match-detail-badge-kills { color: #f2bf63; background: rgba(242, 191, 99, 0.14); }
.match-detail-badge-assists { color: #63d8b4; background: rgba(99, 216, 180, 0.14); }
.match-detail-badge-turrets { color: #59b5ff; background: rgba(89, 181, 255, 0.14); }
.match-detail-badge-gold { color: #f7d35f; background: rgba(247, 211, 95, 0.14); }
.match-detail-badge-taken { color: #ef7d7d; background: rgba(239, 125, 125, 0.14); }
.match-detail-badge-cs { color: #7eb8ff; background: rgba(126, 184, 255, 0.14); }

.match-detail-build-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.match-detail-build-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.match-detail-spells {
  display: flex;
  gap: 2px;
}

.match-detail-spell-icon,
.match-detail-item-icon,
.match-detail-perk-icon {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
}

.match-detail-perks {
  display: flex;
  align-items: center;
  gap: 2px;
}

.match-detail-augment-icon-shell {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 5px;
  border: 1px solid var(--augment-border);
  background: var(--augment-background);
  box-sizing: border-box;
  overflow: hidden;
}

.match-detail-augment-icon {
  width: 12px;
  height: 12px;
  object-fit: contain;
  filter: var(--augment-filter);
}

.match-detail-augment-prismatic {
  --augment-border: rgba(187, 125, 255, 0.92);
  --augment-background: linear-gradient(180deg, rgba(123, 82, 214, 0.9), rgba(55, 34, 110, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(79%) sepia(31%) saturate(2173%) hue-rotate(225deg) brightness(102%) contrast(101%);
}

.match-detail-augment-gold {
  --augment-border: rgba(244, 198, 88, 0.92);
  --augment-background: linear-gradient(180deg, rgba(121, 90, 18, 0.9), rgba(62, 46, 8, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(82%) sepia(51%) saturate(590%) hue-rotate(354deg) brightness(103%) contrast(104%);
}

.match-detail-augment-silver {
  --augment-border: rgba(191, 205, 227, 0.88);
  --augment-background: linear-gradient(180deg, rgba(86, 103, 126, 0.9), rgba(39, 48, 61, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(93%) sepia(10%) saturate(418%) hue-rotate(176deg) brightness(103%) contrast(99%);
}

.match-detail-augment-bronze {
  --augment-border: rgba(197, 132, 89, 0.9);
  --augment-background: linear-gradient(180deg, rgba(118, 67, 35, 0.9), rgba(59, 33, 17, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(76%) sepia(31%) saturate(740%) hue-rotate(338deg) brightness(98%) contrast(94%);
}

.match-detail-augment-default {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
}

.match-detail-perk-icon-sub {
  opacity: 0.88;
}

.match-detail-items {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.match-detail-value-cell {
  font-weight: 600;
  font-size: 11px;
  color: var(--text-primary);
}

.match-detail-kda-value-cell {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.match-detail-kda-separator {
  color: var(--text-tertiary);
}

.match-detail-dots-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.match-detail-empty-state {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  background: var(--bg-base);
}

.match-detail-empty-title {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 700;
}

.match-detail-empty-copy {
  font-size: 12px;
}

@media (max-width: 1100px) {
  .match-detail-header {
    grid-template-columns: 1fr;
  }

  .match-detail-ai-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .match-detail-column-header,
  .match-detail-row {
    grid-template-columns: 1fr;
  }

  .match-detail-column-header {
    display: none;
  }

  .match-detail-row {
    gap: 10px;
  }
}
</style>
