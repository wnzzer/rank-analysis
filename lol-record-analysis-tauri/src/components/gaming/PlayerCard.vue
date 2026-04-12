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
    <div
      v-if="sessionSummoner.isLoading"
      key="loading-known"
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
      <div class="custom-spin"></div>
      <span v-if="sessionSummoner.summoner.gameName" style="font-size: 12px; color: #aaa">
        {{ sessionSummoner.summoner.gameName }}
      </span>
    </div>
    <!-- 仅返回英雄 id、无 summoner 有效信息时视为隐藏战绩，优先展示「战绩已隐藏」 -->
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
                <!-- ARAM Balance Tags 增强/削弱 -->
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
                  :style="{ color: kdaColor(sessionSummoner?.userTag.recentData.kda, isDark) }"
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
                      ),
                      isDark
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
                    :style="{ color: kdaColor(sessionSummoner?.userTag.recentData.kda, isDark) }"
                    style="font-weight: bold; margin-right: 4px"
                  >
                    {{ sessionSummoner?.userTag.recentData.kda }}
                  </span>
                  <span class="kda-detail">
                    <span
                      :style="{
                        color: killsColor(sessionSummoner?.userTag.recentData.kills, isDark)
                      }"
                      >{{ sessionSummoner?.userTag.recentData.kills }}</span
                    >/
                    <span
                      :style="{
                        color: deathsColor(sessionSummoner?.userTag.recentData.deaths, isDark)
                      }"
                      >{{ sessionSummoner?.userTag.recentData.deaths }}</span
                    >/
                    <span
                      :style="{
                        color: assistsColor(sessionSummoner?.userTag.recentData.assists, isDark)
                      }"
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
                        ),
                        isDark
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
                        ),
                        isDark
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
                    :color="groupRateColor(sessionSummoner?.userTag.recentData.groupRate, isDark)"
                    processing
                  />
                  <span
                    class="progress-text"
                    :style="{
                      color: groupRateColor(sessionSummoner?.userTag.recentData.groupRate, isDark)
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
                      otherColor(
                        sessionSummoner?.userTag.recentData.damageDealtToChampionsRate,
                        isDark
                      )
                    "
                    :height="6"
                    :show-indicator="false"
                    processing
                  />
                  <span
                    class="progress-text"
                    :style="{
                      color: otherColor(
                        sessionSummoner?.userTag.recentData.damageDealtToChampionsRate,
                        isDark
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
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { CopyOutline, ChevronDown, ChevronUp } from '@vicons/ionicons5'

import MettingPlayersCard from './MettingPlayersCard.vue'
import { useCopy } from '@renderer/components/composition'
import {
  searchSummoner,
  winRate,
  kdaColor,
  killsColor,
  deathsColor,
  assistsColor,
  otherColor,
  winRateColor,
  groupRateColor
} from '@renderer/components/record/composition'
import { SessionSummoner } from '@renderer/components/gaming/type'
import nullImg from '@renderer/assets/imgs/item/null.png'
import { assetPrefix } from '@renderer/services/http'
import { useSettingsStore } from '@renderer/pinia/setting'

/**
 * 玩家卡片组件
 *
 * 展示单个玩家的详细信息，包括：
 * - 召唤师基本信息（头像、等级、段位）
 * - 近期战绩历史
 * - 玩家标签（预组队标记、用户自定义标签）
 * - ARAM 平衡性调整（仅在极地大乱斗模式下显示）
 * - 近期数据统计（KDA、胜率、参团率、伤害占比）
 *
 * 支持展开/收起详细数据面板
 *
 * @example
 * <PlayerCard
 *   :session-summoner="summonerData"
 *   type-cn="排位赛"
 *   mode-type="RANKED"
 *   :img-url="tierIconUrl"
 *   tier-cn="钻石"
 *   :queue-id="420"
 *   team="blue"
 * />
 */

/**
 * 组件 Props 定义
 */
interface Props {
  /** 玩家会话数据，包含召唤师信息、战绩历史等 */
  sessionSummoner: SessionSummoner
  /** 游戏模式中文名称 */
  typeCn: string
  /** 游戏模式类型标识 */
  modeType: string
  /** 段位图标 URL */
  imgUrl: string
  /** 段位中文名称 */
  tierCn: string
  /** 队列 ID，用于判断是否为 ARAM 模式 */
  queueId: number
  /** 所属队伍（蓝色方/红色方），用于边框颜色区分 */
  team?: 'blue' | 'red'
}

const props = withDefaults(defineProps<Props>(), {
  team: undefined
})

/** 设置状态管理 Store */
const settingsStore = useSettingsStore()

/**
 * 当前是否为暗色主题
 * 用于计算统计数据的颜色显示
 */
const isDark = computed(
  () => settingsStore.theme?.name === 'Dark' || settingsStore.theme?.name === 'dark'
)

/** 复制功能 hook */
const { copy } = useCopy()

/**
 * 是否展开详细统计面板
 * 默认收起，点击后展开显示完整数据
 */
const showStats = ref(false)

/**
 * 判断是否为隐藏战绩的玩家
 *
 * 后端约定：当只返回英雄 ID 但没有有效 summoner 信息时，
 * 表示该玩家隐藏了战绩
 */
const isHiddenRecord = computed(
  () =>
    !!props.sessionSummoner.championId &&
    (!props.sessionSummoner.summoner?.gameName || !props.sessionSummoner.summoner?.puuid)
)

/**
 * ARAM 平衡性数据接口
 * 描述英雄在极地大乱斗模式中的属性调整
 */
interface AramBalanceData {
  /** 造成伤害修正系数 */
  dmg_dealt?: number
  /** 承受伤害修正系数 */
  dmg_taken?: number
  /** 治疗效果修正系数 */
  healing?: number
  /** 护盾效果修正系数 */
  shielding?: number
  /** 技能急速修正值 */
  ability_haste?: number
  /** 法力回复修正系数 */
  mana_regen?: number
  /** 能量回复修正系数 */
  energy_regen?: number
  /** 攻击速度修正系数 */
  attack_speed?: number
  /** 移动速度修正系数 */
  movement_speed?: number
  /** 韧性修正系数 */
  tenacity?: number
}

/**
 * ARAM 平衡性数据
 * 仅在极地大乱斗模式下有值
 */
const aramBalance = ref<AramBalanceData | null>(null)

/**
 * 判断当前是否为 ARAM 模式
 * 450: 极地大乱斗, 2400: 海克斯大乱斗
 */
const isAramMode = computed(() => props.queueId === 450 || props.queueId === 2400)

/**
 * 获取 ARAM 平衡性数据
 *
 * 从 Tauri 后端调用 Rust 函数获取指定英雄的平衡性调整数据
 * 仅在 ARAM 模式下且存在英雄 ID 时执行
 */
const fetchAramBalance = async (): Promise<void> => {
  if (!props.sessionSummoner.championId || !isAramMode.value) return

  try {
    const data = await invoke<AramBalanceData | null>('get_aram_balance', {
      id: props.sessionSummoner.championId
    })
    aramBalance.value = data
  } catch (error) {
    console.error('Failed to fetch ARAM balance:', error)
  }
}

/**
 * ARAM 平衡性标签接口
 */
interface BalanceTag {
  /** 标签显示文本 */
  label: string
  /** 标签描述 */
  desc: string
  /** 标签类型（success=增益, error=削弱） */
  type: 'success' | 'error'
  /** 是否为增益效果 */
  isBuff: boolean
}

/**
 * 计算 ARAM 平衡性标签列表
 *
 * 根据平衡性数据生成可展示的标签
 * 只显示有实际调整的属性（与默认值差异大于 0.1%）
 * 显示属性包括：输出、承伤、治疗、护盾、技能急速
 * 过滤掉的属性：法力回复、能量回复、攻速、移速、韧性
 */
const balanceTags = computed<BalanceTag[]>(() => {
  if (!aramBalance.value) return []

  const tags: BalanceTag[] = []
  const b = aramBalance.value

  /**
   * 格式化百分比数值
   * @param val - 原始数值（如 1.15 表示 +15%）
   * @returns 格式化后的字符串（如 "+15%"）
   */
  const formatPct = (val: number): string => {
    const diff = val - 1
    return (diff > 0 ? '+' : '') + Math.round(diff * 100) + '%'
  }

  // 输出伤害修正
  if (typeof b.dmg_dealt === 'number' && Math.abs(b.dmg_dealt - 1.0) > 0.001) {
    tags.push({
      label: `输出 ${formatPct(b.dmg_dealt)}`,
      desc: '造成伤害修正',
      type: b.dmg_dealt > 1.0 ? 'success' : 'error',
      isBuff: b.dmg_dealt > 1.0
    })
  }

  // 承受伤害修正（数值越小越好）
  if (typeof b.dmg_taken === 'number' && Math.abs(b.dmg_taken - 1.0) > 0.001) {
    tags.push({
      label: `承伤 ${formatPct(b.dmg_taken)}`,
      desc: '承受伤害修正',
      type: b.dmg_taken < 1.0 ? 'success' : 'error',
      isBuff: b.dmg_taken < 1.0
    })
  }

  // 治疗效果修正
  if (typeof b.healing === 'number' && Math.abs(b.healing - 1.0) > 0.001) {
    tags.push({
      label: `治疗 ${formatPct(b.healing)}`,
      desc: '治疗效果修正',
      type: b.healing > 1 ? 'success' : 'error',
      isBuff: b.healing > 1.0
    })
  }

  // 护盾效果修正
  if (typeof b.shielding === 'number' && Math.abs(b.shielding - 1.0) > 0.001) {
    tags.push({
      label: `护盾 ${formatPct(b.shielding)}`,
      desc: '护盾效果修正',
      type: b.shielding > 1 ? 'success' : 'error',
      isBuff: b.shielding > 1.0
    })
  }

  // 技能急速修正（直接数值而非百分比）
  if (typeof b.ability_haste === 'number' && b.ability_haste !== 0) {
    tags.push({
      label: `急速 ${b.ability_haste > 0 ? '+' : ''}${b.ability_haste}`,
      desc: '技能急速修正',
      type: b.ability_haste > 0 ? 'success' : 'error',
      isBuff: b.ability_haste > 0
    })
  }

  return tags
})

/**
 * 总体平衡性状态
 *
 * 根据所有平衡性标签计算总体状态：
 * - 增益标签多于削弱：显示"增强"
 * - 削弱标签多于增益：显示"削弱"
 * - 数量相等：显示"调整"
 * - 无调整：显示"平衡"
 */
const overallBalanceStatus = computed(() => {
  const tags = balanceTags.value
  if (tags.length === 0) {
    return { label: '平衡', type: 'default' as const }
  }

  let buffCount = 0
  let nerfCount = 0

  for (const tag of tags) {
    if (tag.isBuff) buffCount++
    else nerfCount++
  }

  if (buffCount > nerfCount) {
    return { label: '增强', type: 'success' as const }
  } else if (nerfCount > buffCount) {
    return { label: '削弱', type: 'error' as const }
  } else {
    return { label: '调整', type: 'warning' as const }
  }
})

/**
 * 监听英雄 ID 变化，重新获取平衡性数据
 */
watch(() => props.sessionSummoner.championId, fetchAramBalance)

/**
 * 监听游戏模式变化，重新获取平衡性数据
 */
watch(() => isAramMode.value, fetchAramBalance)

/**
 * 组件挂载时获取平衡性数据
 */
onMounted(fetchAramBalance)
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
  justify-content: center;
  align-items: center;
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

.tags-container {
  min-height: 24px;
}

.stats-container {
  position: relative;
}

.stats-card {
  background: var(--glass-bg-low);
  border-radius: var(--radius-md);
  padding: 6px;
  transition: all var(--dur-normal) var(--ease-expo);
  border: 1px solid var(--glass-border);
}

.stats-card.is-expanded {
  position: absolute;
  top: 0;
  right: 0;
  width: 240px;
  z-index: 100;
  background: var(--bg-elevated);
  border-color: rgba(61, 155, 122, 0.25);
  box-shadow: var(--shadow-lg);
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
