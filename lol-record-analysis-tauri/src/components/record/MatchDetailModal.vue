<template>
  <div v-if="game && mySummary" class="match-detail-page">
    <div class="match-detail-modal">
      <div class="match-detail-shell">
        <!-- Header -->
        <div
          class="match-detail-header"
          :class="mySummary.win ? 'match-detail-header--win' : 'match-detail-header--loss'"
        >
          <!-- 氛围底图：本局英雄放大重模糊，向右渐隐——赛后战报的环境感 -->
          <img
            class="match-detail-header-ambient"
            :src="assetPrefix + '/champion/' + mySummary.championId"
            alt=""
            aria-hidden="true"
          />
          <div class="match-detail-header-main">
            <div class="match-detail-title-row">
              <span
                class="match-detail-result-pill"
                :class="
                  mySummary.win ? 'match-detail-result-pill--win' : 'match-detail-result-pill--loss'
                "
              >
                {{ mySummary.win ? '胜利' : '失败' }}
              </span>
              <span class="match-detail-queue">{{ game.queueName }}</span>
              <span class="match-detail-meta">{{ formattedDate }} · {{ durationLabel }}</span>
            </div>
            <div class="match-detail-player-row">
              <LazyImg
                class="match-detail-hero"
                :class="mySummary.win ? 'match-detail-hero--win' : 'match-detail-hero--loss'"
                :src="assetPrefix + '/champion/' + mySummary.championId"
                alt="champion"
              />
              <div class="match-detail-player-copy">
                <div class="match-detail-player-name">{{ mySummary.displayName }}</div>
                <div class="match-detail-player-kda">
                  <span class="font-number">{{ mySummary.stats.kills }}</span>
                  <span>/</span>
                  <span
                    class="font-number"
                    :style="{ color: deathsColor(mySummary.stats.deaths, isDark) }"
                    >{{ mySummary.stats.deaths }}</span
                  >
                  <span>/</span>
                  <span class="font-number">{{ mySummary.stats.assists }}</span>
                  <span
                    class="font-number match-detail-kda-ratio"
                    :style="{ color: kdaColor(kdaRatio(mySummary.stats), isDark) }"
                  >
                    {{ kdaRatioLabel(mySummary.stats) }}
                  </span>
                  <span class="match-detail-meta"
                    >{{ formatCompactNumber(mySummary.stats.goldEarned) }} 金币</span
                  >
                  <span class="match-detail-meta">{{ totalCs(mySummary.stats) }} 补兵</span>
                </div>
              </div>
            </div>
          </div>

          <div class="match-detail-summary-side">
            <div class="match-detail-stats-strip">
              <div class="match-detail-stat">
                <span class="match-detail-stat-label">输出</span>
                <span class="match-detail-stat-value font-number">
                  {{ formatCompactNumber(mySummary.stats.totalDamageDealtToChampions) }}
                </span>
              </div>
              <span class="match-detail-stat-divider" />
              <div class="match-detail-stat">
                <span class="match-detail-stat-label">承伤</span>
                <span class="match-detail-stat-value font-number">
                  {{ formatCompactNumber(mySummary.stats.totalDamageTaken) }}
                </span>
              </div>
              <span class="match-detail-stat-divider" />
              <div class="match-detail-stat">
                <span class="match-detail-stat-label">推塔</span>
                <span class="match-detail-stat-value font-number">
                  {{ formatCompactNumber(mySummary.stats.damageDealtToTurrets) }}
                </span>
              </div>
            </div>

            <n-tooltip trigger="hover" placement="bottom-end">
              <template #trigger>
                <n-button
                  size="small"
                  secondary
                  type="info"
                  class="match-detail-ai-button"
                  :loading="ai.aiLoading.value"
                  @click="onOverview"
                >
                  <template #icon>
                    <n-icon><SparklesOutline /></n-icon>
                  </template>
                  AI 整局复盘
                </n-button>
              </template>
              整局归因 + 单人责任分析
            </n-tooltip>
          </div>
        </div>

        <!-- Team Sections -->
        <!--
          首屏分批渲染：胜方先入场（~50 张图先 race），败方延迟 80ms。
          浏览器对 asset.localhost 并发限制 ~6/host，一次性 100+ 图同时请求会
          排队拖慢首屏；错峰让胜方先抢满 channel，败方再补位。
        -->
        <div class="match-detail-body">
          <section
            v-for="(team, teamIdx) in teamSections"
            v-show="teamIdx < visibleTeamCount"
            :key="team.teamId"
            class="match-detail-team-section"
          >
            <div class="match-detail-team-header" :class="team.headerClass">
              <div class="match-detail-team-title-wrap">
                <span class="match-detail-team-accent" />
                <span class="match-detail-team-title">{{ team.title }}</span>
                <span class="match-detail-team-subtitle font-number">
                  {{ team.kills }}/{{ team.deaths }}/{{ team.assists }} ·
                  {{ formatCompactNumber(team.gold) }} 金币
                </span>
              </div>
              <div class="match-detail-team-subtitle font-number">
                输出 {{ formatCompactNumber(team.damage) }} · 承伤
                {{ formatCompactNumber(team.taken) }}
              </div>
            </div>

            <div class="match-detail-team-card">
              <div class="match-detail-column-header">
                <span>玩家</span>
                <span>技能 / {{ usesAugments ? '海克斯' : '符文' }} / 装备</span>
                <span class="match-detail-header-right">KDA</span>
                <span class="match-detail-header-right">金钱</span>
                <span class="match-detail-header-right">补兵</span>
                <span class="match-detail-header-right">推塔</span>
                <span class="match-detail-bars-header">输出 / 承伤 / 治疗</span>
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
                      <LazyImg
                        class="match-detail-player-avatar"
                        :src="assetPrefix + '/champion/' + player.championId"
                        alt="champion"
                      />
                      <div class="match-detail-player-text">
                        <div class="match-detail-player-text-row">
                          <n-tooltip v-if="player.mvpTag" trigger="hover" placement="top">
                            <template #trigger>
                              <span
                                class="match-detail-mvp-chip"
                                :class="
                                  player.mvpTag === 'MVP'
                                    ? 'match-detail-mvp-chip--mvp'
                                    : 'match-detail-mvp-chip--svp'
                                "
                                >{{ player.mvpTag }}</span
                              >
                            </template>
                            综合评分 {{ player.score.toFixed(1) }} ·
                            KDA/输出/参团/承伤/经济/补刀/推塔 七维加权
                          </n-tooltip>
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
                          <span v-if="player.puuid" @click.stop>
                            <PlayerNoteBadge
                              :puuid="player.puuid"
                              :game-name="player.gameName"
                              :tag-line="player.tagLine"
                              :encounter="buildEncounter(player)"
                              size="normal"
                            />
                          </span>
                          <n-tag v-if="player.isMe" size="small" :bordered="false" type="success"
                            >我</n-tag
                          >
                          <n-tooltip trigger="hover" placement="top">
                            <template #trigger>
                              <n-button
                                quaternary
                                circle
                                size="tiny"
                                class="match-detail-player-ai-trigger"
                                :class="{
                                  'match-detail-player-ai-trigger--busy':
                                    ai.aiLoading.value &&
                                    ai.aiMode.value === 'player' &&
                                    ai.aiTargetParticipantId.value === player.participantId
                                }"
                                :loading="
                                  ai.aiLoading.value &&
                                  ai.aiMode.value === 'player' &&
                                  ai.aiTargetParticipantId.value === player.participantId
                                "
                                @click.stop="ai.openPlayerAnalysis(player.participantId)"
                              >
                                <template #icon>
                                  <n-icon><SparklesOutline /></n-icon>
                                </template>
                              </n-button>
                            </template>
                            AI 单人分析
                          </n-tooltip>
                        </div>
                        <div class="match-detail-badge-row">
                          <n-tooltip
                            v-for="badge in player.badges"
                            :key="badge.key"
                            trigger="hover"
                            placement="top"
                          >
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
                      <!-- 符文/海克斯都跟 spells 同行 (密集布局) -->
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
                              :class="[
                                'match-detail-augment-icon-shell',
                                augmentRarityClass(
                                  assets.detailOf('perk', perkId)?.rarity,
                                  'match-detail-augment'
                                )
                              ]"
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
                              :class="[
                                'match-detail-perk-icon',
                                { 'match-detail-perk-icon-sub': index === 1 }
                              ]"
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
                            :description="assets.detailOf('perk', perkId)?.description ?? ''"
                            :rarity="assets.detailOf('perk', perkId)?.rarity"
                          />
                        </n-tooltip>
                      </div>
                    </div>
                    <div class="match-detail-items">
                      <template
                        v-for="(itemId, index) in itemIds(player.stats)"
                        :key="`${player.participantId}-${index}`"
                      >
                        <n-tooltip
                          v-if="itemId > 0"
                          trigger="hover"
                          placement="top"
                          :disabled="!assets.detailOf('item', itemId)"
                        >
                          <template #trigger>
                            <img
                              :src="assets.srcOf('item', itemId)"
                              class="match-detail-item-icon"
                              :class="{ 'match-detail-item-trinket': index === 6 }"
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
                        <!-- 空装备格：内凹暗槽占位，而非黑块（黑块像图片加载失败） -->
                        <span
                          v-else
                          class="match-detail-item-empty"
                          :class="{ 'match-detail-item-trinket': index === 6 }"
                        />
                      </template>
                    </div>
                  </div>

                  <div class="match-detail-value-cell match-detail-kda-value-cell">
                    <div class="match-detail-kda-line font-number">
                      <span>{{ player.stats.kills }}</span>
                      <span class="match-detail-kda-separator">/</span>
                      <span :style="{ color: deathsColor(player.stats.deaths, isDark) }">{{
                        player.stats.deaths
                      }}</span>
                      <span class="match-detail-kda-separator">/</span>
                      <span>{{ player.stats.assists }}</span>
                    </div>
                    <div
                      class="match-detail-cell-sub font-number"
                      :style="{ color: kdaColor(kdaRatio(player.stats), isDark) }"
                    >
                      {{ kdaRatio(player.stats).toFixed(1) }} KDA
                    </div>
                  </div>
                  <div class="match-detail-value-cell">
                    <div class="font-number">
                      {{ formatCompactNumber(player.stats.goldEarned) }}
                    </div>
                    <div class="match-detail-cell-sub font-number">
                      {{ goldPerMin(player.stats) }}/分
                    </div>
                  </div>
                  <div class="match-detail-value-cell">
                    <div class="font-number">{{ totalCs(player.stats) }}</div>
                    <div class="match-detail-cell-sub font-number">
                      {{ csPerMin(player.stats) }}/分
                    </div>
                  </div>
                  <div class="match-detail-value-cell">
                    <div class="font-number">
                      {{ formatCompactNumber(player.stats.damageDealtToTurrets) }}
                    </div>
                    <!-- 占位副行：撑出与相邻双行列一致的高度，主数值基线全表拉直 -->
                    <div class="match-detail-cell-sub match-detail-cell-sub--ghost font-number">
                      0
                    </div>
                  </div>

                  <!-- 输出/承伤/治疗：按全场最大值刻度的横向对比条（一眼看出谁 carry） -->
                  <div class="match-detail-bars-cell">
                    <n-tooltip
                      v-for="bar in playerBars(player)"
                      :key="`${player.participantId}-${bar.key}`"
                      trigger="hover"
                      placement="left"
                    >
                      <template #trigger>
                        <div class="match-detail-bar-row">
                          <span class="match-detail-bar-value font-number">{{
                            bar.valueText
                          }}</span>
                          <span class="match-detail-bar-track">
                            <span
                              class="match-detail-bar-fill"
                              :class="bar.fillClass"
                              :style="{ width: bar.width }"
                            />
                          </span>
                        </div>
                      </template>
                      {{ bar.tooltip }}
                    </n-tooltip>
                  </div>
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
      :ai-loading="ai.aiLoading.value"
      :ai-state-label="ai.aiStateLabel.value"
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
import { CopyOutline, SparklesOutline } from '@vicons/ionicons5'
import { NButton, NIcon, NTag, NTooltip } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { useCopy } from '@renderer/composables/useCopy'

import { useTheme } from '@renderer/composables/useTheme'
import { assetPrefix } from '@renderer/services/http'
import type { Game, ParticipantStats } from '@renderer/types/domain/match'
import type { Summoner } from '@renderer/types/domain/player'
import AssetTooltipContent from './AssetTooltipContent.vue'
import MatchAIPanel from './MatchAIPanel.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import { deathsColor, kdaColor } from '@renderer/utils/colors'
import { formatCompactNumber } from '@renderer/utils/format'
import { augmentRarityClass } from '@renderer/utils/augment'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import {
  useMatchDetailPlayers,
  type DetailPlayer
} from '@renderer/composables/useMatchDetailPlayers'
import { useMatchAIAnalysis } from '@renderer/composables/useMatchAIAnalysis'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'

const props = defineProps<{ game: Game | null }>()

const { isDark } = useTheme()

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

/** 每分钟补兵（一位小数）；时长缺失时按 1 分钟兜底避免除零 */
function csPerMin(stats: ParticipantStats) {
  const minutes = Math.max(1, (props.game?.gameDuration ?? 60) / 60)
  return (totalCs(stats) / minutes).toFixed(1)
}

/** 每分钟金钱（整数）；与补兵/分同一口径 */
function goldPerMin(stats: ParticipantStats) {
  const minutes = Math.max(1, (props.game?.gameDuration ?? 60) / 60)
  return Math.round(stats.goldEarned / minutes)
}

/** 全场（双方 10 人）各项最大值——对比条的刻度，谁 carry 一眼可见 */
const gameMax = computed(() => {
  let damage = 1
  let taken = 1
  let heal = 1
  for (const p of detailPlayers.value) {
    damage = Math.max(damage, p.stats.totalDamageDealtToChampions)
    taken = Math.max(taken, p.stats.totalDamageTaken)
    heal = Math.max(heal, p.stats.totalHeal)
  }
  return { damage, taken, heal }
})

/** 单名玩家的三根对比条（输出/承伤/治疗）：宽度按全场最大值刻度，占比进 tooltip */
function playerBars(player: DetailPlayer) {
  const s = player.stats
  const m = gameMax.value
  const mk = (
    key: string,
    label: string,
    value: number,
    max: number,
    fillClass: string,
    teamPct: number
  ) => ({
    key,
    label,
    valueText: formatCompactNumber(value),
    width: `${Math.max(3, Math.round((value / max) * 100))}%`,
    fillClass,
    tooltip: `${label} ${value.toLocaleString()} · 占己方 ${teamPct}%`
  })
  return [
    mk(
      'damage',
      '输出',
      s.totalDamageDealtToChampions,
      m.damage,
      'match-detail-bar-fill--damage',
      player.teamRelative.damage
    ),
    mk(
      'taken',
      '承伤',
      s.totalDamageTaken,
      m.taken,
      'match-detail-bar-fill--taken',
      player.teamRelative.taken
    ),
    mk('heal', '治疗', s.totalHeal, m.heal, 'match-detail-bar-fill--heal', player.teamRelative.heal)
  ]
}
function playerAugmentIds(stats: ParticipantStats) {
  return [
    stats.playerAugment1,
    stats.playerAugment2,
    stats.playerAugment3,
    stats.playerAugment4,
    stats.playerAugment5,
    stats.playerAugment6
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

/**
 * 由某玩家 + 当前对局拼出一条"遇见记录"（{@link OneGamePlayer}），
 * 保存备注时并入该玩家的遇见列表，复刻"遇见过"效果。
 * @param player - 详情页玩家
 */
function buildEncounter(player: DetailPlayer): OneGamePlayer | undefined {
  const g = props.game
  if (!g || !player.puuid) return undefined
  return {
    gameCreatedAt: g.gameCreationDate,
    index: 0,
    gameId: g.gameId,
    puuid: player.puuid,
    gameName: player.gameName,
    tagLine: player.tagLine,
    championId: player.championId,
    win: player.win,
    kills: player.stats.kills,
    deaths: player.stats.deaths,
    assists: player.stats.assists,
    isMyTeam: player.teamId === mySummary.value?.teamId,
    queueIdCn: g.queueName ?? ''
  }
}

const durationLabel = computed(() => {
  if (!props.game) return ''
  const minutes = Math.floor(props.game.gameDuration / 60)
  const seconds = props.game.gameDuration % 60
  return `${minutes}分${seconds.toString().padStart(2, '0')}秒`
})

const usesAugments = computed(() => {
  if (!props.game) return false
  // 斗魂所有变种（CHERRY）或海克斯大乱斗（2400）都使用 augment 系统
  const isAugmentMode = props.game.gameMode === 'CHERRY' || props.game.queueId === 2400
  if (!isAugmentMode) return false
  return detailPlayers.value.some(p => playerAugmentIds(p.stats).length > 0)
})

const aiPlayerOptions = computed(() =>
  detailPlayers.value.map(p => ({ label: p.displayName, value: p.participantId }))
)

function onOverview() {
  ai.openOverviewAnalysis(
    mySummary.value?.participantId ?? detailPlayers.value[0]?.participantId ?? null
  )
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

/**
 * 队伍分批渲染计数：onMounted 时只显示第 1 队（胜方），下一帧后再追加败方。
 * 这给浏览器一个错峰窗口避免 100+ asset 请求同时打满并发槽位。
 */
const visibleTeamCount = ref(1)

onMounted(async () => {
  // 先 race 胜方再 race 败方：requestAnimationFrame 让胜方 paint，
  // 80ms 后追加败方（够浏览器把胜方关键图取了大半）。
  setTimeout(() => {
    visibleTeamCount.value = teamSections.value.length
  }, 80)
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
    // 切对局时重新走分批渲染，避免新对局的两队同时 race
    visibleTeamCount.value = 1
    setTimeout(() => {
      visibleTeamCount.value = teamSections.value.length
    }, 80)
    ai.resetOnGameChange(
      mySummary.value?.participantId ?? detailPlayers.value[0]?.participantId ?? null
    )
    loadAssetsIfNeeded()
  },
  { immediate: true }
)
</script>

<style scoped>
.match-detail-page {
  width: 100%;
  height: 100%;
  padding: var(--space-2) var(--space-4) var(--space-4);
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
  border-radius: var(--radius-lg);
  box-sizing: border-box;
  color: var(--text-primary);
  background:
    radial-gradient(
      circle at top left,
      color-mix(in srgb, var(--semantic-win) 14%, transparent),
      transparent 28%
    ),
    radial-gradient(
      circle at top right,
      color-mix(in srgb, var(--accent-blue) 16%, transparent),
      transparent 32%
    ),
    var(--bg-base);
}

.match-detail-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.match-detail-header {
  --hdr-color: var(--semantic-win);
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-10) var(--space-12);
  border-bottom: 1px solid var(--border-subtle);
  /* 头部单独一层极轻的表面色，与正文区分层次 */
  background: linear-gradient(180deg, var(--glass-bg-low), transparent);
}

.match-detail-header--win {
  --hdr-color: var(--semantic-win);
}

.match-detail-header--loss {
  --hdr-color: var(--semantic-loss);
}

/* 胜负环境光：左上角一团结果色的径向光晕——不依赖英雄图明暗，始终可见且克制 */
.match-detail-header::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    120% 190% at 7% 18%,
    color-mix(in srgb, var(--hdr-color) 17%, transparent),
    transparent 56%
  );
  pointer-events: none;
}

/* 氛围底图：英雄图放大重模糊、向右渐隐——页面级环境光，非组件毛玻璃 */
.match-detail-header-ambient {
  /* 源图仅 128px：重模糊会糊成看不见的色雾。改为"幽灵浮雕"——
     大尺寸 + 轻模糊保留轮廓 + 径向渐隐，英雄的脸若隐若现衬在标题后 */
  position: absolute;
  left: -36px;
  top: 50%;
  transform: translateY(-50%);
  width: 300px;
  height: 300px;
  object-fit: cover;
  filter: blur(2px) brightness(1.3) saturate(1.15);
  opacity: 0.3;
  pointer-events: none;
  -webkit-mask-image: radial-gradient(circle at 34% 50%, rgba(0, 0, 0, 0.9) 22%, transparent 68%);
  mask-image: radial-gradient(circle at 34% 50%, rgba(0, 0, 0, 0.9) 22%, transparent 68%);
}

.theme-light .match-detail-header-ambient {
  opacity: 0.1;
}

.match-detail-header-main,
.match-detail-summary-side {
  position: relative;
  z-index: 1;
}

/* 结果徽章：色字 + 淡底 + 内描边微光，比通用 tag 更有份量 */
.match-detail-result-pill {
  --result-color: var(--semantic-win);
  padding: var(--space-2) var(--space-10);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--result-color);
  background: color-mix(in srgb, var(--result-color) 13%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--result-color) 38%, transparent),
    0 0 12px color-mix(in srgb, var(--result-color) 16%, transparent);
}

.match-detail-result-pill--win {
  --result-color: var(--semantic-win);
}

.match-detail-result-pill--loss {
  --result-color: var(--semantic-loss);
}

.match-detail-title-row {
  display: flex;
  align-items: center;
  gap: 5px; /* 标签之间紧凑间距,介于 4 和 6 */
  margin-bottom: var(--space-4);
}

.match-detail-queue {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-meta {
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
}

.match-detail-player-row {
  display: flex;
  align-items: center;
  gap: 7px; /* 头像与文字间距,介于 6 和 8 */
}

.match-detail-hero {
  /* 48→60px 随 viewport (1100→2200)——头部主视觉，比正文头像大一档 */
  width: clamp(48px, calc(48px + (100vw - 1100px) * 12 / 1100), 60px);
  height: clamp(48px, calc(48px + (100vw - 1100px) * 12 / 1100), 60px);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  display: block;
}

/* 胜负色环：双层描边（内深外发光），头部一眼读出结果 */
.match-detail-hero--win {
  border-color: color-mix(in srgb, var(--semantic-win) 55%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--semantic-win) 25%, transparent),
    0 0 14px color-mix(in srgb, var(--semantic-win) 22%, transparent);
}

.match-detail-hero--loss {
  border-color: color-mix(in srgb, var(--semantic-loss) 50%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--semantic-loss) 22%, transparent),
    0 0 14px color-mix(in srgb, var(--semantic-loss) 18%, transparent);
}

.match-detail-player-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.match-detail-player-name {
  /* 15→19px 随 viewport (1100→2200) */
  font-size: clamp(15px, calc(15px + (100vw - 1100px) * 4 / 1100), 19px);
  font-weight: 700;
  color: var(--text-primary);
}

.match-detail-player-kda {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.match-detail-kda-ratio {
  margin-left: var(--space-4);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

/* 头部右侧：一条无边框统计带 + 一颗 AI 主按钮（替代旧的两层边框盒子） */
.match-detail-summary-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-6);
}

.match-detail-stats-strip {
  display: flex;
  align-items: center;
  gap: var(--space-10);
}

.match-detail-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.match-detail-stat-label {
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
}

.match-detail-stat-value {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.match-detail-stat-divider {
  width: 1px;
  height: 22px;
  background: var(--border-subtle);
}

.match-detail-ai-button {
  -webkit-app-region: no-drag;
}

.match-detail-body {
  overflow: auto;
  padding: var(--space-8) var(--space-12) var(--space-10);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

/* 细滚动条，替代系统默认宽条 */
.match-detail-body::-webkit-scrollbar {
  width: 6px;
}

.match-detail-body::-webkit-scrollbar-thumb {
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--text-tertiary) 35%, transparent);
}

.match-detail-body::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-tertiary) 55%, transparent);
}

.match-detail-body::-webkit-scrollbar-track {
  background: transparent;
}

/* 区块 = 排版式标签 + 卡片（去一层盒子：标题悬于卡片之上，不再是"卡片里的色条"） */
.match-detail-team-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex-shrink: 0;
}

.match-detail-team-card {
  border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.015);
}

.theme-light .match-detail-team-card {
  background: var(--bg-elevated);
}

/* 队伍标签行：色点 + 色字 + 数据，纯排版、无底无框 */
.match-detail-team-header {
  --team-color: var(--semantic-win);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-6);
  padding: 0 var(--space-4);
}

.match-detail-team-header-win {
  --team-color: var(--semantic-win);
}

.match-detail-team-header-loss {
  --team-color: var(--semantic-loss);
}

.match-detail-team-accent {
  width: 4px;
  height: 16px;
  border-radius: var(--radius-xs);
  background: var(--team-color);
  box-shadow: 0 0 8px color-mix(in srgb, var(--team-color) 55%, transparent);
  flex-shrink: 0;
}

.match-detail-team-title-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.match-detail-team-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--team-color);
  letter-spacing: 0.02em;
}

.match-detail-team-subtitle {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.match-detail-column-header,
.match-detail-row {
  display: grid;
  /* build 列锁定 216px：弹性只留给玩家列，避免中部出现大片死空间；
     数字列全部右对齐双行，主数值基线全表一条直线 */
  grid-template-columns: minmax(188px, 1fr) 216px 84px 78px 72px 68px 180px;
  gap: var(--space-6);
  align-items: center;
}

.match-detail-column-header {
  /* 水平 padding 与数据行统一 12px；透明底 + 发丝线，弱化表头存在感 */
  padding: var(--space-4) var(--space-12);
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  background: transparent;
  border-bottom: 1px solid var(--border-subtle);
  text-transform: none;
}

/* 表头数字列与数据行 text-align 对齐 */
.match-detail-header-right {
  text-align: right;
}

/* 条形区列头与条形区内容同步左缩进 */
.match-detail-bars-header {
  padding-left: var(--space-8);
}

.theme-light .match-detail-column-header {
  background: var(--glass-bg-low);
}

.match-detail-team-rows {
  display: flex;
  flex-direction: column;
}

.match-detail-row {
  /* 垂直 6px 呼吸感 + 水平 12px 与列头统一 */
  padding: var(--space-6) var(--space-12);
  border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  transition: background var(--dur-fast) var(--ease-expo);
  position: relative;
}

.match-detail-row:hover {
  background: var(--glass-bg-mid);
}

.match-detail-row:last-child {
  border-bottom: none;
}

/* "我" 行高亮：与主题 accent 同色系（wash + 左条），不再蓝绿混用 */
.match-detail-row-me {
  background: color-mix(in srgb, var(--semantic-win) 10%, transparent);
  box-shadow: inset 3px 0 0 0 var(--semantic-win);
}

.match-detail-row-me:hover {
  background: color-mix(in srgb, var(--semantic-win) 16%, transparent);
}

.theme-light .match-detail-row-me {
  background: color-mix(in srgb, var(--semantic-win) 8%, transparent);
}

.match-detail-player-main {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.match-detail-player-avatar {
  /* 密集模式: 32→40 */
  width: clamp(32px, calc(32px + (100vw - 1100px) * 8 / 1100), 40px);
  height: clamp(32px, calc(32px + (100vw - 1100px) * 8 / 1100), 40px);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
  display: block;
}

.match-detail-player-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  /* 锁定两行高度：无徽章的行名字不再垂直居中漂移，
     全表玩家名保持同一条顶线（"歪"感的来源之一） */
  min-height: 34px;
  justify-content: flex-start;
}

.match-detail-player-text-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.match-detail-player-display {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 行内 AI 按钮：默认隐身，行 hover 或加载中才浮现——把每行常驻噪音降到最低 */
.match-detail-player-ai-trigger {
  --n-text-color: var(--text-secondary);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-expo);
}

.match-detail-row:hover .match-detail-player-ai-trigger,
.match-detail-player-ai-trigger--busy {
  opacity: 1;
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
  gap: var(--space-4);
}

/* MVP/SVP 章：金/银双档，WeGame 式综合评分的胜败双方最高分 */
.match-detail-mvp-chip {
  --chip-color: var(--accent-gold);
  padding: 1px var(--space-6);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-2xs);
  font-weight: 800;
  font-style: italic;
  letter-spacing: 0.04em;
  line-height: 1.3;
  color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--chip-color) 45%, transparent);
  flex-shrink: 0;
}

.match-detail-mvp-chip--mvp {
  --chip-color: var(--accent-gold);
}

.match-detail-mvp-chip--svp {
  --chip-color: #aab8c8;
}

.match-detail-player-text-row :deep(.n-tag) {
  color: var(--text-primary);
}

.match-detail-badge-icon {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight);
}

/* 战绩荣誉徽章配色：与战绩页 KDA/输出/承伤 色系一致 */
.match-detail-badge-kills {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 14%, transparent);
}
.match-detail-badge-damage {
  color: var(--accent-gold-deep);
  background: color-mix(in srgb, var(--accent-gold-deep) 16%, transparent);
}
.match-detail-badge-assists {
  color: var(--semantic-win-bright);
  background: color-mix(in srgb, var(--semantic-win-bright) 14%, transparent);
}
.match-detail-badge-turrets {
  color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
}
.match-detail-badge-gold {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 14%, transparent);
}
.match-detail-badge-taken {
  color: var(--semantic-loss-bright);
  background: color-mix(in srgb, var(--semantic-loss-bright) 14%, transparent);
}
.match-detail-badge-cs {
  color: var(--accent-blue);
  background: color-mix(in srgb, var(--accent-blue) 14%, transparent);
}

/* 多杀荣誉徽章：五杀金（底色更浓一档以示最高荣誉）/ 四杀琥珀 / 三杀蓝 */
.match-detail-badge-penta {
  color: var(--accent-gold);
  background: color-mix(in srgb, var(--accent-gold) 22%, transparent);
}
.match-detail-badge-quadra {
  color: var(--semantic-warn);
  background: color-mix(in srgb, var(--semantic-warn) 16%, transparent);
}
.match-detail-badge-triple {
  color: var(--accent-sky);
  background: color-mix(in srgb, var(--accent-sky) 14%, transparent);
}

.match-detail-build-cell {
  display: flex;
  flex-direction: column;
  /* 密集: topline 与 items 间距 4→2 */
  gap: var(--space-2);
}

.match-detail-build-topline {
  /* 技能+符文紧凑同组靠左——不再 space-between（会把符文推到列右缘，像悬空 bug） */
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-6);
}

.match-detail-spells {
  display: flex;
  gap: var(--space-2);
}

.match-detail-spell-icon,
.match-detail-item-icon,
.match-detail-perk-icon {
  /* 18→22px 随 viewport：比旧 16 大一档，看得清图标细节 */
  width: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  height: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  border-radius: var(--radius-control);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  object-fit: cover;
}

.match-detail-perks {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.match-detail-augment-icon-shell {
  --augment-border: rgba(172, 185, 201, 0.42);
  --augment-background: linear-gradient(180deg, rgba(56, 65, 78, 0.92), rgba(27, 32, 41, 0.96));
  --augment-filter: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 紧凑: 16→20 跟 spell/item/perk 同步 */
  width: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  height: clamp(16px, calc(16px + (100vw - 1100px) * 4 / 1100), 20px);
  border-radius: var(--radius-control);
  border: 1px solid var(--augment-border);
  background: var(--augment-background);
  box-sizing: border-box;
  overflow: hidden;
}

.match-detail-augment-icon {
  /* inner 11→15 跟 shell 同步 */
  width: clamp(11px, calc(11px + (100vw - 1100px) * 4 / 1100), 15px);
  height: clamp(11px, calc(11px + (100vw - 1100px) * 4 / 1100), 15px);
  object-fit: contain;
  filter: var(--augment-filter);
}

.match-detail-augment-prismatic {
  --augment-border: rgba(187, 125, 255, 0.92);
  --augment-background: linear-gradient(180deg, rgba(123, 82, 214, 0.9), rgba(55, 34, 110, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(79%) sepia(31%) saturate(2173%)
    hue-rotate(225deg) brightness(102%) contrast(101%);
}

.match-detail-augment-gold {
  --augment-border: rgba(244, 198, 88, 0.92);
  --augment-background: linear-gradient(180deg, rgba(121, 90, 18, 0.9), rgba(62, 46, 8, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(82%) sepia(51%) saturate(590%)
    hue-rotate(354deg) brightness(103%) contrast(104%);
}

.match-detail-augment-silver {
  --augment-border: rgba(191, 205, 227, 0.88);
  --augment-background: linear-gradient(180deg, rgba(86, 103, 126, 0.9), rgba(39, 48, 61, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(93%) sepia(10%) saturate(418%)
    hue-rotate(176deg) brightness(103%) contrast(99%);
}

.match-detail-augment-bronze {
  --augment-border: rgba(197, 132, 89, 0.9);
  --augment-background: linear-gradient(180deg, rgba(118, 67, 35, 0.9), rgba(59, 33, 17, 0.98));
  --augment-filter: brightness(0) saturate(100%) invert(76%) sepia(31%) saturate(740%)
    hue-rotate(338deg) brightness(98%) contrast(94%);
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
  gap: var(--space-2);
}

/* 空装备格：内凹暗槽，与实图标同尺寸——避免黑块被误读为图片加载失败 */
.match-detail-item-empty {
  width: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  height: clamp(18px, calc(18px + (100vw - 1100px) * 4 / 1100), 22px);
  border-radius: var(--radius-control);
  border: 1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 45%, transparent);
  box-sizing: border-box;
  flex-shrink: 0;
}

/* 饰品格（第 7 格）与前六格之间留出一档间距分组 */
.match-detail-item-trinket {
  margin-left: var(--space-4);
}

/* 数字单元格：统一右对齐 + 双行（主值 + 副行），全表共用一套结构。
   主值 sm 字号——数字要有存在感 */
.match-detail-value-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.match-detail-kda-line {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.match-detail-kda-separator {
  color: var(--text-tertiary);
}

/* 副行：每分钟/比值等次要信息，全列统一字号与色阶 */
.match-detail-cell-sub {
  font-size: var(--font-size-2xs);
  font-weight: 500;
  color: var(--text-tertiary);
  line-height: 1.2;
}

/* 占位副行：仅撑高度不显示——让单行列与双行列的主数值基线对齐 */
.match-detail-cell-sub--ghost {
  visibility: hidden;
}

/* 输出/承伤/治疗对比条：值 + 按全场最大值刻度的横向条。
   左侧留一档缩进，与推塔数字列拉开——两簇数字不贴身（拥挤感来源之一） */
.match-detail-bars-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: var(--space-8);
}

.match-detail-bar-row {
  /* 标签不逐行重复（列头已说明），色彩+顺序+tooltip 即可辨识——条更长更干净 */
  display: grid;
  grid-template-columns: 44px 1fr;
  align-items: center;
  gap: var(--space-4);
}

.match-detail-bar-value {
  font-size: var(--font-size-2xs);
  font-weight: 600;
  color: var(--text-secondary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.match-detail-bar-track {
  height: 4px;
  border-radius: var(--radius-xs);
  background: var(--glass-bg-mid);
  overflow: hidden;
}

.theme-light .match-detail-bar-track {
  background: var(--glass-bg-high);
}

.match-detail-bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-xs);
  transition: width var(--dur-normal) var(--ease-expo);
}

/* 三色与旧图标底色同系：输出琥珀 / 承伤蓝 / 治疗绿 */
.match-detail-bar-fill--damage {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent-gold-deep) 55%, transparent),
    color-mix(in srgb, var(--accent-gold-deep) 95%, transparent)
  );
}

.match-detail-bar-fill--taken {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent-blue) 50%, transparent),
    color-mix(in srgb, var(--accent-blue) 92%, transparent)
  );
}

.match-detail-bar-fill--heal {
  background: linear-gradient(90deg, rgba(88, 182, 109, 0.5), rgba(88, 182, 109, 0.92));
}

.match-detail-empty-state {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-8);
  color: var(--text-secondary);
  background: var(--bg-base);
}

.match-detail-empty-title {
  color: var(--text-primary);
  font-size: var(--font-size-xl);
  font-weight: 700;
}

.match-detail-empty-copy {
  font-size: var(--font-size-sm);
}

@media (max-width: 1100px) {
  .match-detail-header {
    grid-template-columns: 1fr;
  }

  .match-detail-summary-side {
    align-items: flex-start;
  }

  .match-detail-column-header,
  .match-detail-row {
    grid-template-columns: 1fr;
  }

  .match-detail-column-header {
    display: none;
  }

  .match-detail-row {
    gap: var(--space-10);
  }
}
</style>
