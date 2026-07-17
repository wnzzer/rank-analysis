<template>
  <n-card
    class="player-card"
    :class="[
      { 'light-mode-strip': settingsStore.theme?.name === 'Light' },
      props.team === 'blue' && 'player-card-team-blue',
      props.team === 'red' && 'player-card-team-red',
      props.team === 'mine' && 'player-card-team-mine',
      props.team === 'enemy' && 'player-card-team-enemy',
      `player-card-density-${props.density}`,
      pickStateClassName,
      justSwapped && 'pc-swapped'
    ]"
    size="small"
    :bordered="true"
    :content-style="cardContentStyle"
  >
    <div v-if="sessionSummoner.isLoading" key="loading-known" class="loading-container">
      <div class="custom-spin"></div>
      <span v-if="sessionSummoner.summoner.gameName" class="loading-name">
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
          <n-flex align="center" :wrap="false" class="profile-row">
            <div class="avatar-wrapper">
              <n-image
                width="100%"
                :src="assetPrefix + '/champion/' + sessionSummoner.championId"
                preview-disabled
                :fallback-src="nullImg"
                class="champion-img"
              />
              <div class="level-badge">{{ sessionSummoner?.summoner.summonerLevel }}</div>
            </div>

            <div class="info-wrapper">
              <n-flex align="center" class="name-row">
                <n-button
                  text
                  @click="
                    searchSummoner(
                      sessionSummoner?.summoner.gameName + '#' + sessionSummoner?.summoner.tagLine
                    )
                  "
                >
                  <n-ellipsis class="name-ellipsis">
                    {{ sessionSummoner?.summoner.gameName }}
                  </n-ellipsis>
                </n-button>
                <n-tag v-if="isSelf" size="small" type="success" round :bordered="false">
                  我
                </n-tag>
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
                <PlayerNoteBadge
                  v-if="sessionSummoner.summoner.puuid"
                  :puuid="sessionSummoner.summoner.puuid"
                  :game-name="sessionSummoner.summoner.gameName"
                  :tag-line="sessionSummoner.summoner.tagLine"
                  size="small"
                />
              </n-flex>

              <n-flex align="center" class="meta-row">
                <span class="tag-line">#{{ sessionSummoner?.summoner.tagLine }}</span>
                <n-flex align="center" class="tier-row">
                  <span v-if="imgUrl.includes('unranked')" class="tier-icon-placeholder">
                    <n-icon><HelpCircleOutline /></n-icon>
                  </span>
                  <LazyImg v-else class="tier-icon" :src="imgUrl" alt="tier" />
                  <span class="tier-text">{{ tierCn }}</span>
                </n-flex>
                <!-- 当前英雄的 OP.GG T 级/胜率 chip：opggMode 未传或无数据时不渲染（无占位） -->
                <n-tooltip v-if="opggMeta" trigger="hover">
                  <template #trigger>
                    <span class="opgg-chip">
                      <span
                        v-if="opggBadge.label"
                        class="opgg-chip-tier"
                        :style="{ color: opggBadge.color, backgroundColor: opggBadge.bg }"
                        >{{ opggBadge.label }}</span
                      >
                      <span class="opgg-chip-rate" :class="opggWinRateClass">{{
                        formatWinRate(opggMeta.winRate)
                      }}</span>
                    </span>
                  </template>
                  OP.GG：该英雄在当前模式的梯度与全球胜率（非玩家个人胜率）
                </n-tooltip>
                <PatchNoteBadge :champion-id="sessionSummoner.championId" :mode="opggMode" />
                <!-- ARAM Balance Status -->
                <n-popover
                  v-if="balanceTags.length > 0 && isAramMode"
                  trigger="hover"
                  :style="{ padding: 'var(--space-4)' }"
                >
                  <template #trigger>
                    <n-tag
                      size="small"
                      :type="overallBalanceStatus.type"
                      :bordered="false"
                      round
                      class="balance-tag"
                    >
                      {{ overallBalanceStatus.label }}
                    </n-tag>
                  </template>
                  <n-flex vertical size="small" class="balance-list">
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
              <n-tooltip v-if="sessionSummoner.preGroupMarkers?.name" trigger="hover">
                <template #trigger>
                  <n-tag size="small" :type="sessionSummoner.preGroupMarkers.type as any">
                    {{ sessionSummoner.preGroupMarkers.name }}
                  </n-tag>
                </template>
                预组队：近期多次同队，大概率一起排的；编号仅区分不同组
              </n-tooltip>
              <n-tag v-if="sessionSummoner.meetGames?.length > 0" type="warning" size="small" round>
                <n-popover trigger="hover">
                  <template #trigger>遇见过 ×{{ sessionSummoner.meetGames.length }}</template>
                  <MettingPlayersCard :meet-games="sessionSummoner.meetGames"></MettingPlayersCard>
                </n-popover>
              </n-tag>
              <UnifiedTagRow
                :tags="sessionSummoner?.userTag?.tag || []"
                :puuid="sessionSummoner.summoner.puuid"
                :game-name="sessionSummoner.summoner.gameName"
                :tag-line="sessionSummoner.summoner.tagLine"
              />
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
import { computed, nextTick, onUnmounted, ref, toRef, watch } from 'vue'
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
import { CopyOutline, HelpCircleOutline } from '@vicons/ionicons5'
import MettingPlayersCard from './MettingPlayersCard.vue'
import { useCopy } from '@renderer/composables/useCopy'
import { searchSummoner } from '@renderer/utils/navigation'
import type { SessionSummoner } from '@renderer/types/domain/gaming'
import nullImg from '@renderer/assets/imgs/item/null.png'
import { assetPrefix } from '@renderer/services/http'
import { useSettingsStore } from '@renderer/pinia/setting'
import { useTheme } from '@renderer/composables/useTheme'
import { useAramBalance } from '@renderer/composables/useAramBalance'
import PlayerHistoryGrid from './PlayerHistoryGrid.vue'
import PlayerStatsCard from './PlayerStatsCard.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import PlayerNoteBadge from '@renderer/components/common/PlayerNoteBadge.vue'
import PatchNoteBadge from './PatchNoteBadge.vue'
import UnifiedTagRow from '@renderer/components/common/UnifiedTagRow.vue'
import { getChampionMeta, type ChampionMeta, type OpggMode } from '@renderer/services/opgg'
import { tierBadge, formatWinRate, playerCardPickStateClass, isChampionSwap } from './championIntel'

interface Props {
  sessionSummoner: SessionSummoner
  typeCn: string
  modeType: string
  imgUrl: string
  tierCn: string
  queueId: number
  team?: 'blue' | 'red' | 'mine' | 'enemy' | undefined
  density?: 'normal' | 'compact'
  /**
   * OP.GG 数据模式：驱动当前英雄 T 级/胜率 chip。
   * PlayerCard 目前仅被 SubteamCard（对局页）复用，未传（如未来被非对局场景复用）时
   * 完全不发起请求、也不渲染 chip。
   */
  opggMode?: OpggMode
  /**
   * 选人态：'none'/'intent'/'picking'/'banning'/'locked'/''。
   * 仅由 SubteamCard 在 ChampSelect 阶段传入我方玩家的实时选人态，驱动四态动画；
   * 非选人期（对局中等）恒为空，PlayerCard 不带任何选人态修饰。
   */
  pickState?: string
  /** 是否是自己：名字旁标「我」，与战绩详情窗口的约定一致 */
  isSelf?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  team: undefined,
  density: 'normal',
  pickState: '',
  isSelf: false
})

/** n-card content-style：用 token 控制内边距（P0 收紧为 --space-4 让 4 场 1 屏装下） */
const cardContentStyle = 'padding: var(--space-4);'

/** pickState → 根元素修饰类，驱动选人四态动画（意向/选择中/禁用中/已锁定） */
const pickStateClassName = computed(() => playerCardPickStateClass(props.pickState))

/**
 * 换人一次性闪烁反馈：仅当已锁定（pickState === 'locked'）后 championId 仍发生真实变化
 * （对应选人阶段锁定后的英雄交换 trade）时点亮 `pc-swapped`，~600ms 后自动移除。
 * 未锁定期换意向是常态，不触发；机制与 ChampionIntelCard 同款（先归零一帧再点亮，保证连续
 * 快速换人也能重播动画）。
 */
const justSwapped = ref(false)
let swapFlashTimer: ReturnType<typeof setTimeout> | null = null

function triggerSwapFlash(): void {
  if (swapFlashTimer) clearTimeout(swapFlashTimer)
  justSwapped.value = false
  void nextTick(() => {
    justSwapped.value = true
    swapFlashTimer = setTimeout(() => {
      justSwapped.value = false
      swapFlashTimer = null
    }, 600)
  })
}

onUnmounted(() => {
  if (swapFlashTimer) clearTimeout(swapFlashTimer)
})

watch(
  () => props.sessionSummoner.championId,
  (id, oldId) => {
    if (props.pickState === 'locked' && isChampionSwap(oldId, id)) {
      triggerSwapFlash()
    }
  }
)

const settingsStore = useSettingsStore()
const { isDark } = useTheme()

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

/** 当前英雄的 OP.GG 元数据（T 级/胜率），驱动 chip；championId<=0 或 opggMode 未传时保持 null */
const opggMeta = ref<ChampionMeta | null>(null)
const opggBadge = computed(() => tierBadge(opggMeta.value?.tier ?? 0))
/** 胜率语义色：>=52% 绿、<=48% 红，与 ChampionIntelCard 同一套规则 */
const opggWinRateClass = computed(() => {
  const rate = opggMeta.value?.winRate
  if (rate === undefined || rate <= 0) return ''
  if (rate >= 0.52) return 'opgg-chip-rate-good'
  if (rate <= 0.48) return 'opgg-chip-rate-bad'
  return ''
})

/**
 * 上一次实际发起处理的请求标识（championId + opggMode 拼接）。
 * 与 ChampionIntelCard 同款内容级请求守卫：key 未变则跳过，避免同局内每次会话事件重拉。
 */
let lastOpggRequestKey = ''

watch(
  () => [props.sessionSummoner.championId, props.opggMode] as const,
  async ([championId, mode]) => {
    const requestKey = `${championId}|${mode ?? ''}`
    if (requestKey === lastOpggRequestKey) return
    lastOpggRequestKey = requestKey

    if (!mode || !championId || championId <= 0) {
      opggMeta.value = null
      return
    }
    // 竞态守卫：旧请求晚到不得覆盖新数据（英雄/模式快速切换场景）
    const requestKeySnapshot = requestKey
    const fetchedMeta = await getChampionMeta(mode, championId)
    if (lastOpggRequestKey !== requestKeySnapshot) return
    opggMeta.value = fetchedMeta
  },
  { immediate: true }
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
  gap: var(--space-8);
}

.loading-name {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.profile-row {
  gap: var(--space-10);
}

.name-row {
  gap: var(--space-4);
}

/* :deep 因为 .name-ellipsis 在 n-ellipsis 子组件根，scoped 属性不自动透传 */
:deep(.name-ellipsis) {
  /* 110px: 名称列最大宽度（窄屏限制），宽屏放开 */
  max-width: clamp(110px, calc(110px + (100vw - 900px) * 60 / 2100), 170px);
  /* 13→20px 随 viewport 平滑放大 (900→3000) */
  font-size: clamp(13px, calc(13px + (100vw - 900px) * 7 / 2100), 20px);
  font-weight: 700;
}

.meta-row {
  gap: var(--space-6);
  flex-wrap: wrap;
}

.tier-row {
  gap: var(--space-4);
}

/* 当前英雄 OP.GG T 级/胜率 chip：样式简化版复用 ChampionIntelCard 的 intel-tier/intel-winrate 语义 */
.opgg-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-2xs);
  padding: 0 var(--space-6);
  height: 18px;
  line-height: 18px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.12);
}

.opgg-chip-tier {
  font-weight: 700;
  padding: 0 4px;
  border-radius: 999px;
}

.opgg-chip-rate {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.opgg-chip-rate-good {
  color: var(--semantic-win);
  opacity: 1;
  font-weight: 600;
}

.opgg-chip-rate-bad {
  color: var(--semantic-loss);
  opacity: 1;
  font-weight: 600;
}

.balance-tag {
  /* 18px / cursor:help：紧凑标签固定高度，不入 token */
  height: 18px;
  padding: 0 var(--space-6);
  font-size: var(--font-size-xs);
  cursor: help;
}

.balance-list {
  gap: var(--space-4);
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
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-tertiary);
}

.left-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
}

.right-section {
  /* 100px: 右侧统计列固定宽，保持视觉对齐 */
  width: 100px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  margin-left: var(--space-8);
}

.profile-section {
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--n-divider-color);
}

.avatar-wrapper {
  position: relative;
  /* 头像平滑缩放：900 视口=36, 3000 视口=60 (含 4K) */
  width: clamp(36px, calc(36px + (100vw - 900px) * 24 / 2100), 60px);
  height: clamp(36px, calc(36px + (100vw - 900px) * 24 / 2100), 60px);
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
  bottom: calc(var(--space-6) * -1);
  right: calc(var(--space-6) * -1);
  font-size: var(--font-size-2xs);
  /* 黑色半透明叠加层，固定不入主题 token */
  background: rgba(0, 0, 0, 0.7);
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  color: white;
  /* 14px 行高对齐徽标视觉，固定 UI */
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
  gap: var(--space-4);
  justify-content: flex-end;
  align-items: center;
  padding-left: var(--space-8);
}

.copy-btn {
  opacity: 0.6;
  transition: opacity var(--dur-fast) var(--ease-expo);
}

.copy-btn:hover {
  opacity: 1;
}

.tag-line {
  color: var(--n-text-color-3);
  font-size: var(--font-size-sm);
}

.tier-icon {
  /* 20→32px 随 viewport 平滑放大 (900→3000) */
  display: inline-block;
  width: clamp(20px, calc(20px + (100vw - 900px) * 12 / 2100), 32px);
  height: clamp(20px, calc(20px + (100vw - 900px) * 12 / 2100), 32px);
}

.tier-icon :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* 未定级时用 n-icon 占位（QuestionMark），保持视觉权重一致 */
.tier-icon-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: clamp(20px, calc(20px + (100vw - 900px) * 12 / 2100), 32px);
  height: clamp(20px, calc(20px + (100vw - 900px) * 12 / 2100), 32px);
  font-size: clamp(18px, calc(18px + (100vw - 900px) * 11 / 2100), 29px);
  color: var(--text-tertiary);
}

.tier-text {
  font-size: var(--font-size-sm);
  color: var(--n-text-color-2);
}

.custom-spin {
  /* 22px: spinner 固定尺寸 */
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
  color: var(--semantic-warn) !important;
  border: 1px solid rgba(251, 191, 36, 0.2) !important;
}

.player-card-team-mine {
  border-left: 2px solid var(--team-blue);
  border-color: var(--border-subtle);
  border-left-color: rgba(34, 197, 94, 0.7);
}

.player-card-team-enemy {
  border-left: 2px solid var(--team-red);
  border-color: var(--border-subtle);
  border-left-color: rgba(239, 68, 68, 0.5);
}

.player-card-density-compact .right-section {
  display: none;
}

.player-card-density-compact .left-section {
  gap: var(--space-4);
}

.player-card-density-compact :deep(.player-history-grid) {
  grid-template-columns: repeat(2, 1fr);
}

.player-card-density-compact .info-wrapper :deep(.n-button) {
  font-size: var(--font-size-sm);
}

/* ---- 选人四态动画（同 ChampionIntelCard 的视觉语言：琥珀呼吸/绿脉冲/红脉冲/锁定过冲）----
 * PlayerCard 比情报卡内容重得多，直接照搬 box-shadow ring 会撞上 .player-card 已有的
 * `box-shadow: ... !important`（CSS 优先级里 author !important 高于 CSS 动画，动画对它
 * 无效）。这里改用 filter: drop-shadow 做发光（不受该 !important 影响，且天然贴合圆角），
 * 边框色/宽度走静态声明——靠复合选择器 `.player-card.pc-xxx` 的更高特异度 + 同为
 * !important 正常参与层叠，无需动画介入。逗号组合规则同情报卡：fade-up 恒第一位，
 * 状态动画第二位，delay 列表对应（stagger 延迟, 0s）。
 */
.player-card.pc-intent {
  border-width: 1px !important;
  border-color: rgba(230, 193, 90, 0.55) !important;
  animation:
    fade-up var(--dur-normal) var(--ease-expo) both,
    pc-breathe 2s ease-in-out infinite;
  animation-delay: calc(var(--stagger) * var(--stagger-i, 0)), 0s;
}
@keyframes pc-breathe {
  0%,
  100% {
    filter: drop-shadow(0 0 0 transparent);
  }
  50% {
    filter: drop-shadow(0 0 6px rgba(230, 193, 90, 0.22));
  }
}

.player-card.pc-picking {
  border-width: 2px !important;
  border-color: var(--semantic-win) !important;
  animation:
    fade-up var(--dur-normal) var(--ease-expo) both,
    pc-pulse 1.1s ease-in-out infinite;
  animation-delay: calc(var(--stagger) * var(--stagger-i, 0)), 0s;
}
@keyframes pc-pulse {
  0%,
  100% {
    filter: drop-shadow(0 0 0 rgba(34, 197, 94, 0));
  }
  50% {
    filter: drop-shadow(0 0 5px rgba(34, 197, 94, 0.25));
  }
}

/* 禁用阶段是全队同时进行的——ban 时 5 张卡（加敌方 5 个占位）一起变红，
   所以这里刻意比 pc-picking 克制：1px 半透明边框 + 更慢更弱的呼吸，只做状态提示不抢焦点 */
.player-card.pc-banning {
  border-width: 1px !important;
  border-color: color-mix(in srgb, var(--semantic-loss) 45%, transparent) !important;
  animation:
    fade-up var(--dur-normal) var(--ease-expo) both,
    pc-ban-pulse 2s ease-in-out infinite;
  animation-delay: calc(var(--stagger) * var(--stagger-i, 0)), 0s;
}
@keyframes pc-ban-pulse {
  0%,
  100% {
    filter: drop-shadow(0 0 0 rgba(239, 68, 68, 0));
  }
  50% {
    filter: drop-shadow(0 0 3px rgba(239, 68, 68, 0.12));
  }
}

/* 锁定：一次性 ring 闪光 + 轻微 scale 过冲，比情报卡的 0.82→1.05→1 收敛很多——
   PlayerCard 尺寸大，同等幅度的 scale 在真实布局里观感是"晃"而非"确认感" */
.player-card.pc-locked {
  animation:
    fade-up var(--dur-normal) var(--ease-expo) both,
    pc-lock-in 0.28s var(--ease-expo) both;
  animation-delay: calc(var(--stagger) * var(--stagger-i, 0)), 0s;
}
@keyframes pc-lock-in {
  0% {
    transform: scale(0.99);
    filter: drop-shadow(0 0 6px rgba(34, 197, 94, 0.28));
  }
  60% {
    transform: scale(1.008);
    filter: drop-shadow(0 0 3px rgba(34, 197, 94, 0.14));
  }
  100% {
    transform: scale(1);
    filter: drop-shadow(0 0 0 transparent);
  }
}

/* 选人期未锁定（意向/选择中/禁用中）：头像半透明+降饱和，表达"还没定"；
   locked 与非选人期（无 pc-* 类）保持头像正常展示 */
.player-card.pc-intent .champion-img,
.player-card.pc-picking .champion-img,
.player-card.pc-banning .champion-img {
  opacity: 0.7;
  filter: saturate(80%);
}

/* 换人闪烁：一次性反馈，动画只落在头像元素上（同 ChampionIntelCard 的 intel-swapped 机制），
 * 不往 .player-card 的 fade-up/四态逗号动画列表里加第三项，避免破坏既有组合规则。
 */
.player-card.pc-swapped .champion-img {
  animation: pc-swap-flash 0.5s ease-out;
}
@keyframes pc-swap-flash {
  0% {
    filter: brightness(1);
  }
  40% {
    filter: brightness(1.6);
  }
  100% {
    filter: brightness(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-card.pc-intent,
  .player-card.pc-picking,
  .player-card.pc-banning,
  .player-card.pc-locked,
  .player-card.pc-swapped .champion-img {
    animation: none;
  }
}
</style>
