<template>
  <div v-if="game && mySummary" class="match-detail-inline">
    <div class="match-detail-page">
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
                    mySummary.win
                      ? 'match-detail-result-pill--win'
                      : 'match-detail-result-pill--loss'
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
                  <!--
                  进行中刻意不使用 :loading —— naive-ui Button 在 loading 态
                  根本不 emit click（Button.mjs:146），会让"进行中"意外等价于
                  "永久不可点"。这里只用 disabled 表达真正的不可用（客户端没开、
                  版本不符等），进行中靠 spin 图标与文案表达，语义不混。
                -->
                  <n-button
                    size="small"
                    secondary
                    class="match-detail-replay-button"
                    :disabled="!replay.canPlay.value"
                    @click="replay.play"
                  >
                    <template #icon>
                      <n-spin v-if="replay.busy.value" :size="14" />
                      <n-icon v-else><CirclePlay /></n-icon>
                    </template>
                    {{ replay.buttonLabel.value }}
                  </n-button>
                </template>
                {{ replay.disabledReason.value || '在游戏客户端中观看本局回放' }}
              </n-tooltip>

              <n-tooltip trigger="hover" placement="bottom-end">
                <template #trigger>
                  <!--
                  刻意不用 :loading —— naive-ui Button 在 loading 时根本不 emit click
                  （node_modules/naive-ui/es/button/src/Button.mjs:146），关掉面板后
                  就再也点不回来。进行中改用 spin 图标表达，按钮始终可点。
                -->
                  <n-button
                    size="small"
                    secondary
                    type="info"
                    class="match-detail-ai-button"
                    @click="onOverview"
                  >
                    <template #icon>
                      <n-spin v-if="ai.aiLoading.value" :size="14" />
                      <n-icon v-else><Sparkles /></n-icon>
                    </template>
                    AI 整局复盘
                  </n-button>
                </template>
                整局归因 + 单人责任分析
              </n-tooltip>

              <n-tooltip trigger="hover" placement="bottom-end">
                <template #trigger>
                  <n-button
                    size="small"
                    secondary
                    circle
                    class="match-detail-close-button"
                    @click="emit('close')"
                  >
                    <template #icon>
                      <n-icon><X /></n-icon>
                    </template>
                  </n-button>
                </template>
                收起详情
              </n-tooltip>
            </div>
          </div>

          <!-- Tab 栏：主组（概览/统计/符文/出装/时间线）+ 次组（事件/评分/回测，
               视觉弱化并加分隔——低频分析不与高频页签抢宽度，KeepAlive 保活 + 懒加载 -->
          <div class="match-detail-tabs" role="tablist">
            <template v-for="(tab, i) in tabs" :key="tab.key">
              <span
                v-if="tab.minor && !(tabs[i - 1] && tabs[i - 1].minor)"
                class="match-detail-tab-divider"
                aria-hidden="true"
              ></span>
              <button
                type="button"
                role="tab"
                class="match-detail-tab"
                :class="{
                  'match-detail-tab--active': activeTab === tab.key,
                  'match-detail-tab--minor': tab.minor
                }"
                :aria-selected="activeTab === tab.key"
                @click="activeTab = tab.key"
              >
                {{ tab.label }}
              </button>
            </template>
          </div>

          <div class="match-detail-tab-pane">
            <KeepAlive>
              <component :is="activeTabComponent" />
            </KeepAlive>
          </div>

          <MatchAIPanel
            :show="ai.showAiModal.value"
            :mode="ai.aiMode.value"
            :target-participant-id="ai.aiTargetParticipantId.value"
            :loading="ai.aiLoading.value"
            :ai-loading="ai.aiLoading.value"
            :ai-state-label="ai.aiStateLabel.value"
            :report="ai.aiReport.value"
            :rendered-result="ai.renderedAiResult.value"
            :player-options="aiPlayerOptions"
            @update:show="ai.showAiModal.value = $event"
            @update:mode="ai.aiMode.value = $event"
            @update:target-participant-id="ai.aiTargetParticipantId.value = $event"
            @rerun="ai.runCurrentAiAnalysis"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch, onMounted, toRef, provide } from 'vue'
import { CirclePlay, Sparkles, X } from 'lucide-vue-next'
import { NButton, NIcon, NTooltip } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { useCopy } from '@renderer/composables/useCopy'

import { useTheme } from '@renderer/composables/useTheme'
import { assetPrefix } from '@renderer/services/http'
import type { Game, ParticipantStats } from '@renderer/types/domain/match'
import type { Summoner } from '@renderer/types/domain/player'
import MatchAIPanel from './MatchAIPanel.vue'
import LazyImg from '@renderer/components/common/LazyImg.vue'
import { deathsColor, kdaColor } from '@renderer/utils/colors'
import { formatCompactNumber, formatGameDate } from '@renderer/utils/format'
import { useRecordAssets } from '@renderer/composables/useRecordAssets'
import { useMatchDetailPlayers } from '@renderer/composables/useMatchDetailPlayers'
import { useMatchAIAnalysis } from '@renderer/composables/useMatchAIAnalysis'
import { useMatchReplay } from '@renderer/composables/useMatchReplay'
import { useMatchPlayerRanks } from '@renderer/composables/useMatchPlayerRanks'
import type { DetailPlayer } from '@renderer/composables/useMatchDetailPlayers'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import { matchDetailContextKey, type SgpDetailStatus } from './matchDetailContext'
import { getSgpMatchDetail, type SgpGameDetail } from '@renderer/features/record/services/sgp'
import MatchDetailSummaryTab from './tabs/MatchDetailSummaryTab.vue'
import MatchDetailStatsTab from './tabs/MatchDetailStatsTab.vue'
import MatchDetailRunesTab from './tabs/MatchDetailRunesTab.vue'
import MatchDetailEventsTab from './tabs/MatchDetailEventsTab.vue'
import MatchDetailBuildsTab from './tabs/MatchDetailBuildsTab.vue'
import MatchDetailTimelineTab from './tabs/MatchDetailTimelineTab.vue'
import MatchDetailScoreTab from './tabs/MatchDetailScoreTab.vue'
import MatchDetailBacktestTab from './tabs/MatchDetailBacktestTab.vue'
import MatchDetailReviewTab from './tabs/MatchDetailReviewTab.vue'

const props = defineProps<{ game: Game | null; region?: string }>()
const emit = defineEmits<{ close: [] }>()

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
const regionRef = toRef(() => props.region ?? '')
const players = useMatchDetailPlayers(gameRef, currentPlayerKey)
const { detailPlayers, mySummary } = players
const ai = useMatchAIAnalysis(gameRef)
const replay = useMatchReplay(gameRef)
const assets = useRecordAssets()
const { copy } = useCopy()
// 段位跟随本局队列（440 灵活组排 / 其余单双排），语义与 useSessionTiers 的 pickQueueInfo 一致；
// 跨区详情（region 非空）走 SGP rankedStats 直查（LCU 段位端点只能查当前登录区）
const ranks = useMatchPlayerRanks(
  detailPlayers,
  () => props.game?.queueId,
  () => props.region
)

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
    stats.playerAugment4,
    stats.playerAugment5,
    stats.playerAugment6
  ].filter(id => id > 0)
}

const formattedDate = computed(() => {
  if (!props.game) return ''
  return formatGameDate(props.game.gameCreationDate)
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
    for (const id of perkIdsOf(player)) if (id > 0) perkIdsToLoad.add(id)
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
 * 完整符文图标集合：扁平三字段（SummaryTab 用）+ 完整符文页（RunesTab 用：
 * styles 全量 selections + 风格 + statPerks 属性碎片）。
 */
function perkIdsOf(player: DetailPlayer): number[] {
  const ids = new Set<number>(displayedPerkIds(player.stats))
  const perks = player.perks
  if (!perks) return [...ids]
  for (const style of perks.styles) {
    if (style.style > 0) ids.add(style.style)
    for (const sel of style.selections) if (sel.perk > 0) ids.add(sel.perk)
  }
  const sp = perks.statPerks
  if (sp) {
    if (sp.offense > 0) ids.add(sp.offense)
    if (sp.flex > 0) ids.add(sp.flex)
    if (sp.defense > 0) ids.add(sp.defense)
  }
  return [...ids]
}

function displayedPerkIds(stats: ParticipantStats) {
  if (usesAugments.value) {
    const ids = playerAugmentIds(stats)
    if (ids.length > 0) return ids
  }
  return [stats.perk0, stats.perkSubStyle].filter(id => id > 0)
}

// ── SGP 单局详情（事件/时间线 tab 共用，懒加载 + 局级缓存）──
const sgpDetail = ref<SgpGameDetail | null>(null)
const sgpDetailStatus = ref<SgpDetailStatus>('idle')

async function loadSgpDetail() {
  // 幂等：loading 中不重复发；error 可重试（重试按钮直接调本函数）
  if (sgpDetailStatus.value === 'loading' || sgpDetailStatus.value === 'ready') return
  const g = props.game
  if (!g) return
  sgpDetailStatus.value = 'loading'
  try {
    const resp = await getSgpMatchDetail(g.platformId, g.gameId)
    if (resp === null) {
      // 服务层吞错返回 null（网络/token/主机映射失败）——置 error，tab 展示错误态 + 重试
      sgpDetail.value = null
      sgpDetailStatus.value = 'error'
      return
    }
    sgpDetail.value = resp.json ?? null
    sgpDetailStatus.value = 'ready'
  } catch (err) {
    console.error('[record] SGP DETAILS 加载失败', err)
    sgpDetail.value = null
    sgpDetailStatus.value = 'error'
  }
}

provide(matchDetailContextKey, {
  game: gameRef,
  region: regionRef,
  players,
  ranks,
  assets,
  ai,
  usesAugments,
  isDark,
  copy,
  buildEncounter,
  itemIds,
  playerAugmentIds,
  displayedPerkIds,
  sgpDetail,
  sgpDetailStatus,
  loadSgpDetail
})

/** tab 定义：7 tab（概览 / 数据对比 / 符文 / 事件 / 出装 / 时间线 / 评分）全部落地 */
const tabs = [
  { key: 'summary', label: '概览', component: MatchDetailSummaryTab },
  {
    key: 'stats',
    label: '数据对比',
    component: MatchDetailStatsTab
  },
  {
    key: 'runes',
    label: '符文',
    component: MatchDetailRunesTab
  },
  { key: 'events', label: '事件', component: MatchDetailEventsTab, minor: true },
  {
    key: 'builds',
    label: '出装',
    component: MatchDetailBuildsTab
  },
  {
    key: 'timeline',
    label: '时间线',
    component: MatchDetailTimelineTab
  },
  { key: 'score', label: '评分', component: MatchDetailScoreTab, minor: true },
  { key: 'review', label: '评审', component: MatchDetailReviewTab, minor: true },
  { key: 'backtest', label: '决策回测', component: MatchDetailBacktestTab, minor: true }
]

const activeTab = ref('summary')
const activeTabComponent = computed(() => {
  const tab = tabs.find(t => t.key === activeTab.value) ?? tabs[0]
  return tab.component
})

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
    ai.resetOnGameChange(
      mySummary.value?.participantId ?? detailPlayers.value[0]?.participantId ?? null
    )
    loadAssetsIfNeeded()
    sgpDetail.value = null
    sgpDetailStatus.value = 'idle'
  },
  { immediate: true }
)
</script>

<style scoped>
.match-detail-inline {
  width: 100%;
  margin-top: var(--space-8);
}

.match-detail-page {
  width: 100%;
  padding: var(--space-2) var(--space-4) var(--space-4);
  box-sizing: border-box;
  background: var(--bg-base);
}

.match-detail-modal {
  width: 100%;
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
}

.match-detail-header {
  --hdr-color: var(--semantic-win);
  position: relative;
  overflow: hidden;
  /* 头部是固定内容区，绝不参与压缩：它是 .match-detail-shell（flex column, height:100%）
     的子项，默认 flex-shrink:1 会在窗口高度不足时被挤扁。一旦挤扁，比左栏更高的右侧
     按钮列（统计条 + 观看回放 + AI 整局复盘）就会超出头部，被上面的 overflow:hidden
     裁掉底部——表现为「AI 整局复盘」按钮缺一截。窗口越矮越明显。
     该滚动的是下面的正文区，不是头部。 */
  flex-shrink: 0;
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

.match-detail-ai-button,
.match-detail-replay-button {
  -webkit-app-region: no-drag;
}

/* Tab 栏：胶囊切换条，概览默认激活 */
.match-detail-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-12) 0;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

/* 次组页签：弱化 + 前置细分隔（R6：低频 tab 不与高频抢宽度） */
.match-detail-tab--minor {
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.match-detail-tab-divider {
  width: 1px;
  height: 14px;
  align-self: center;
  background: var(--border-subtle);
  margin: 0 var(--space-4);
}
.match-detail-tab {
  appearance: none;
  border: none;
  background: transparent;
  padding: var(--space-6) var(--space-10);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  transition:
    color var(--dur-fast) var(--ease-expo),
    background var(--dur-fast) var(--ease-expo);
}

.match-detail-tab:hover {
  color: var(--text-primary);
  background: var(--glass-bg-low);
}

.match-detail-tab--active {
  color: var(--text-primary);
  font-weight: 700;
}

.match-detail-tab--active::after {
  content: '';
  position: absolute;
  left: var(--space-6);
  right: var(--space-6);
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent-gold);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.55);
}

/* tab 内容区：KeepAlive 组件挂载点 */
.match-detail-tab-pane {
  display: flex;
  flex-direction: column;
}

@media (max-width: 1100px) {
  .match-detail-header {
    grid-template-columns: 1fr;
  }

  .match-detail-summary-side {
    align-items: flex-start;
  }
}
</style>
