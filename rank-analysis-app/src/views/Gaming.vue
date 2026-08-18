<!--
  注意：本组件被 Framework 的 <Transition mode="out-in"> 包裹，模板根层级
  （含各 v-if 分支的直接子级）必须保持单元素——dev 模式下模板注释会保留成
  vnode，与元素并列会让根变成 Fragment，离场过渡卡死（表现为切页黑屏、点不回去）。
  要写注释请放元素内部或这里。
-->
<template>
  <template v-if="!sessionData.phase">
    <LoadingComponent :hint="isConnected ? '进入英雄选择后这里会自动展示对局分析' : undefined">
      <!-- 已连接时不提示「启动客户端」——那会跟左下角的绿色连接灯自相矛盾 -->
      {{ isConnected ? '等待加入游戏...' : '未连接到客户端' }}
    </LoadingComponent>
  </template>
  <template v-else>
    <div class="gaming-page">
      <n-button
        circle
        secondary
        type="primary"
        class="gaming-config-btn"
        @click="showConfig = true"
      >
        <template #icon>
          <n-icon><settings-outline /></n-icon>
        </template>
      </n-button>

      <!-- AI 分析按钮 -->
      <n-tooltip v-model:show="showAITooltip" placement="left" :duration="5000">
        <template #trigger>
          <!--
            刻意不用 :loading —— naive-ui Button 在 loading 时根本不 emit click
            （node_modules/naive-ui/es/button/src/Button.mjs:146），会把用户锁在
            面板外面。进行中改用 spin 图标表达，按钮始终可点、随时能开回面板。
          -->
          <n-button
            circle
            secondary
            type="info"
            class="gaming-ai-btn"
            :disabled="!sessionData.phase"
            @click="handleOpenPanel"
          >
            <template #icon>
              <n-spin v-if="ai.loading.value || live.loading.value" :size="14" />
              <n-icon v-else><sparkles-outline /></n-icon>
            </template>
          </n-button>
        </template>
        ✨ AI分析功能：选人期分析阵容情报，对局中实时分析出装/经济/团战，赛后复盘整局
      </n-tooltip>

      <n-modal v-model:show="showConfig" preset="card" title="显示设置" style="width: 400px">
        <n-form-item label="战绩显示数量">
          <n-input-number
            v-model:value="matchCount"
            :min="1"
            :max="20"
            @update:value="handleUpdateConfig"
          />
        </n-form-item>
        <span class="gaming-config-hint">设置将在下一次刷新或对局时生效</span>
      </n-modal>

      <!-- AI 分析结果弹窗（D-P2 三 tab：选人期 / 对局中 / 赛后，各自独立进度） -->
      <n-modal
        v-model:show="ai.showPanel.value"
        preset="card"
        :title="aiPanelTitle"
        style="width: 640px"
      >
        <template #header-extra>
          <n-button
            size="small"
            tertiary
            type="primary"
            :disabled="currentTabLoading"
            @click="rerunCurrentTab"
          >
            重新分析
          </n-button>
        </template>
        <n-tabs v-model:value="aiTab" type="line" animated>
          <n-tab-pane name="champSelect" tab="选人期">
            <div
              v-if="champSelectRendered"
              class="ai-result-content ai-report"
              v-html="champSelectRendered"
            ></div>
            <div v-else-if="ai.kindState.champSelect.loading.value" class="ai-result-skeleton">
              <div class="ai-result-skeleton-label">AI 正在分析选人期阵容...</div>
              <n-skeleton text :repeat="4" />
              <n-skeleton text style="width: 60%" />
            </div>
            <div v-else class="ai-result-empty">暂无选人期分析结果，点「重新分析」生成。</div>
          </n-tab-pane>
          <n-tab-pane name="live" tab="对局中">
            <div v-if="live.inGame.value" class="ai-live-hint">
              对局实时数据每 15 秒自动更新<template v-if="liveUpdatedAt">
                · 最后更新 {{ liveUpdatedAt }}</template
              >
            </div>
            <div
              v-if="live.renderedResult.value"
              class="ai-result-content ai-report"
              v-html="live.renderedResult.value"
            ></div>
            <div v-else-if="live.loading.value" class="ai-result-skeleton">
              <div class="ai-result-skeleton-label">AI 正在分析对局实时数据...</div>
              <n-skeleton text :repeat="4" />
              <n-skeleton text style="width: 60%" />
            </div>
            <div v-else class="ai-result-empty">
              {{
                live.inGame.value ? '暂无对局中分析结果，点「重新分析」生成。' : '当前不在对局中。'
              }}
            </div>
          </n-tab-pane>
          <n-tab-pane name="game" tab="赛后">
            <div
              v-if="gameRendered"
              class="ai-result-content ai-report"
              v-html="gameRendered"
            ></div>
            <div v-else-if="ai.kindState.game.loading.value" class="ai-result-skeleton">
              <div class="ai-result-skeleton-label">AI 正在分析整局...</div>
              <n-skeleton text :repeat="4" />
              <n-skeleton text style="width: 60%" />
            </div>
            <div v-else class="ai-result-empty">暂无赛后分析结果，点「重新分析」生成。</div>
          </n-tab-pane>
        </n-tabs>
      </n-modal>

      <div class="gaming-intel-banner">
        <div class="banner-main" :class="{ 'banner-main-split': champSelectStage }">
          <!-- 阶段 stepper：预选/禁用/选人/确认，仅 stage 非空时展示；'' 时保留原有单行文案 -->
          <div v-if="champSelectStage" class="stage-stepper">
            <template v-for="(step, i) in STAGE_STEPS" :key="step.key">
              <div
                class="stage-step"
                :class="{
                  'stage-step-active': i === currentStageIndex,
                  'stage-step-done': i < currentStageIndex
                }"
              >
                <span class="stage-dot"></span>
                <span class="stage-label">{{ step.label }}</span>
              </div>
              <span
                v-if="i < STAGE_STEPS.length - 1"
                class="stage-connector"
                :class="{ 'stage-connector-done': i < currentStageIndex }"
              ></span>
            </template>
          </div>
          <div class="banner-meta">
            <template v-if="bannerPhaseLabel">{{ bannerPhaseLabel }} · </template
            >{{ sessionData.typeCn }}
            <template v-if="opggStatus">
              · OP.GG {{ opggStatus.patch
              }}<span v-if="opggStatus.stale" class="banner-stale">（数据滞后）</span>
            </template>
            <!-- 段位仅对 ranked 快照有意义：aram 快照没有段位概念，
                 在那里给下拉等于承诺一个不存在的能力 -->
            <n-select
              v-if="opggMode === 'ranked'"
              :value="opggTier"
              :options="TIER_OPTIONS"
              :loading="opggTierLoading"
              :disabled="opggTierLoading"
              size="tiny"
              class="banner-tier-select"
              @update:value="onTierChange"
            />
          </div>
        </div>

        <!-- 双方 ban 条：位于 stepper 下、grid 上，任一方有 ban 才展示整块 -->
        <div v-if="hasBans" class="ban-bar">
          <div class="ban-group">
            <span class="ban-group-label">我方禁用</span>
            <div v-if="myBans.length > 0" class="ban-icons">
              <img
                v-for="id in myBans"
                :key="`my-ban-${id}`"
                class="ban-icon"
                :src="getChampionUrl(id)"
                :alt="`ban-${id}`"
              />
            </div>
            <span v-else class="ban-group-empty">-</span>
          </div>
          <div class="ban-group">
            <span class="ban-group-label">敌方禁用</span>
            <div v-if="theirBans.length > 0" class="ban-icons">
              <img
                v-for="id in theirBans"
                :key="`their-ban-${id}`"
                class="ban-icon"
                :src="getChampionUrl(id)"
                :alt="`ban-${id}`"
              />
            </div>
            <span v-else class="ban-group-empty">-</span>
          </div>
        </div>

        <BpDecisionBar
          :decision="bp.decision.value"
          :display-secs="bp.displaySecs.value"
          @save-rule="handleSaveRule"
        />

        <!-- 双方阵容强度对比条：锁定英雄 ≥1 即出现，数据不足时整块隐藏 -->
        <TeamStrengthBar
          :mine="lineupScores.scores.value.mine"
          :enemy="lineupScores.scores.value.enemy"
        />
        <!-- 对位分析（同分路画像均值差 ≥2%，确定性计算） -->
        <div v-if="lineupScores.scores.value.matchupHints.length > 0" class="matchup-hints">
          <div
            v-for="(hint, i) in lineupScores.scores.value.matchupHints"
            :key="i"
            class="matchup-hint"
          >
            {{ hint }}
          </div>
        </div>
        <!-- 敌方打野节奏（SGP 战绩前 10 分钟击杀分布，确定性计算） -->
        <div v-if="lineupScores.scores.value.junglePatternLine" class="jungle-pattern">
          {{ lineupScores.scores.value.junglePatternLine }}
        </div>
      </div>

      <div class="gaming-grid" :class="{ 'gaming-grid-multi': sessionData.isMultiTeam }">
        <div v-for="st of orderedSubteams" :key="`subteam-col-${st.subteamId}`" class="subteam-col">
          <BestPicksPanel
            v-if="showBestPicks && panelForColumn(st)"
            :enemy-ids="enemyLockedIds"
            :candidate-ids="bestPickCandidates"
            :teammate-ids="teammatePickedIds"
            :my-position="teammatesMyPosition"
            :tier="opggTier"
            :tier-loading="opggTierLoading"
            :region="'global'"
            :my-summoner-name="mySummonerName"
            @switch-tier="onTierChange"
          />
          <SubteamCard
            :subteam="st"
            :is-mine="st.subteamId === sessionData.mySubteamId"
            :expected-size="expectedSubteamSize"
            :type-cn="sessionData.typeCn"
            :mode-type="sessionData.type"
            :queue-id="sessionData.queueId"
            :tiers-by-subteam="tiersBySubteam"
            :density="density"
            :phase="sessionData.phase"
            :opgg-mode="opggMode"
            :my-champion-ids="myChampionIds"
            :my-puuid="mySummonerPuuid"
            :my-position="teammatesMyPosition"
            :tier="opggTier"
          />
        </div>
      </div>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { SettingsOutline, SparklesOutline } from '@vicons/ionicons5'
import { useMessage } from 'naive-ui'

import LoadingComponent from '@renderer/components/LoadingComponent.vue'
import SubteamCard from '@renderer/components/gaming/SubteamCard.vue'
import BestPicksPanel from '@renderer/components/gaming/BestPicksPanel.vue'
import BpDecisionBar from '@renderer/components/gaming/BpDecisionBar.vue'
import TeamStrengthBar from '@renderer/components/gaming/TeamStrengthBar.vue'
import { useGamingAIAnalysis } from '@renderer/composables/useGamingAIAnalysis'
import { useLiveAIAnalysis } from '@renderer/composables/useLiveAIAnalysis'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { useBpDecision } from '@renderer/composables/useBpDecision'
import { useLineupScore } from '@renderer/composables/useLineupScore'
import { useSessionSync } from '@renderer/composables/useSessionSync'
import { useSessionTiers } from '@renderer/composables/useSessionTiers'
import { useGameState } from '@renderer/composables/useGameState'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import { usePickRules, useBanRules } from '@renderer/composables/useRules'
import {
  ensureOpggData,
  getOpggStatus,
  queueIdToOpggMode,
  TIER_OPTIONS,
  type OpggStatus,
  type OpggTier
} from '@renderer/services/opgg'
import { useOpggTier } from '@renderer/composables/useOpggTier'
import { buildRuleDraft } from '@renderer/features/gaming/services/bpRuleDraft'
import { normalizeLcuPosition } from '@renderer/features/gaming/services/counterIntel'
import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import type { Position, PickRule, BanRule } from '@renderer/types/rules'
import type { ChampSelect, Subteam } from '@renderer/types/domain/gaming'
import type { championOption } from '@renderer/types/domain/champion'

/** 选人阶段 stepper 的四步定义，顺序与展示文案固定 */
const STAGE_STEPS: Array<{ key: string; label: string }> = [
  { key: 'planning', label: '预选' },
  { key: 'banning', label: '禁用' },
  { key: 'picking', label: '选人' },
  { key: 'finalization', label: '确认' }
]

const { sessionData, requestSessionData } = useSessionSync()
const tiersBySubteam = useSessionTiers(sessionData)
const { getChampionUrl } = useAssetUrl()
const { isConnected, summoner: mySummoner } = useGameState()

/** 自己的 puuid，用于在玩家卡上标出「我」 */
const mySummonerPuuid = computed(() => mySummoner.value?.puuid ?? '')

/** 自己的召唤师名（格式 名称#标签），供推荐面板拉取我的英雄池；无召唤师信息时为空 */
const mySummonerName = computed(() => {
  const s = mySummoner.value
  return s?.gameName ? `${s.gameName}#${s.tagLine ?? ''}` : ''
})

const density = computed<'normal' | 'compact'>(() =>
  sessionData.isMultiTeam ? 'compact' : 'normal'
)

const expectedSubteamSize = computed(() => (sessionData.isMultiTeam ? 2 : 5))

const orderedSubteams = computed(() => {
  // 我方排第一格；其它按 subteamId 升序
  const my = sessionData.subteams.find(s => s.subteamId === sessionData.mySubteamId)
  const others = sessionData.subteams
    .filter(s => s.subteamId !== sessionData.mySubteamId)
    .sort((a, b) => a.subteamId - b.subteamId)
  return my ? [my, ...others] : others
})

/**
 * 推荐条落列规则：敌方已锁 ≥2 → 显示在敌方列（对位视角）；敌方未锁/不足但
 * 我方队友已亮 ≥1 → 显示在我方列（纯协同视角）。两态互斥，避免面板重复。
 */
const panelForColumn = (st: Subteam): boolean => {
  if (st.subteamId === sessionData.mySubteamId) {
    return enemyLockedIds.value.length < 2 && teammatePickedIds.value.length >= 1
  }
  return enemyLockedIds.value.length >= 2
}

/**
 * 我方已亮队友英雄 id（含 intent/picking/locked，排除 ban 态与我自己）：
 * 协同推荐以「队友预选/锁定」为锚（场景：辅助预选 X → 推荐协同最优 AD）。
 */
const teammatePickedIds = computed(() => {
  const my = orderedSubteams.value.find(s => s.subteamId === sessionData.mySubteamId)
  return (
    my?.players
      .filter(
        p =>
          p.championId > 0 &&
          p.pickState !== 'banning' &&
          p.summoner.puuid !== mySummonerPuuid.value
      )
      .map(p => p.championId) ?? []
  )
})

/** 我本局分路（LCU 命名 top/jungle/...；空 = 位置未知，不过滤候选池） */
const teammatesMyPosition = computed(() => {
  const pos = myPosition.value
  // 大小写不敏感校验：LCU 下发的是小写，直接 positionToOpgg 会漏判
  return pos && normalizeLcuPosition(pos) ? pos : ''
})

/** 当前对局对应的 OP.GG 数据模式（ARAM 队列走 aram，其余走 ranked） */
const opggMode = computed(() => queueIdToOpggMode(sessionData.queueId))

/** 我方已亮出的英雄 id 列表（用于敌方情报卡的克制提示，过滤未选中的 0/负值） */
const myChampionIds = computed(
  () =>
    orderedSubteams.value
      .find(s => s.subteamId === sessionData.mySubteamId)
      ?.players.map(p => p.championId)
      .filter(id => id > 0) ?? []
)

/**
 * P2 候选池：全量英雄列表（get_champion_options 一次性拉取，懒加载）。
 * 只依赖后端命令，与 loadChampionNames 各自独立、无冲突。
 */
const allChampionIds = ref<number[]>([])
let championOptionsLoaded = false

/** 候选池懒加载：仅 ranked && ChampSelect 且敌方锁定 ≥1 时才首次拉取 */
async function ensureChampionOptions(): Promise<void> {
  if (championOptionsLoaded) return
  try {
    const options = await invoke<championOption[]>('get_champion_options')
    allChampionIds.value = options.map(o => o.value)
    championOptionsLoaded = true
  } catch (e) {
    console.warn('[gaming] 候选池拉取失败:', e)
  }
}

/** 敌方已锁英雄 id（>0 即已锁定；敌方 intent 恒 0 无需区分 pickState） */
const enemyLockedIds = computed(
  () =>
    orderedSubteams.value
      .filter(s => s.subteamId !== sessionData.mySubteamId)
      .flatMap(s => s.players.map(p => p.championId))
      .filter(id => id > 0) ?? []
)

/** 推荐隐藏规则：ranked 队列 && 选人阶段 && 候选池已就绪 */
const showBestPicks = computed(
  () =>
    opggMode.value === 'ranked' &&
    sessionData.phase === 'ChampSelect' &&
    allChampionIds.value.length > 0
)

/**
 * 候选集：全量池排除 双方 ban / 我方已亮（含 intent、picking、locked）/
 * 敌方已锁——被占用或被禁的英雄不参与「最优应对」推荐。
 */
const bestPickCandidates = computed(() => {
  if (allChampionIds.value.length === 0) return []
  const taken = new Set<number>([
    ...myBans.value,
    ...theirBans.value,
    ...myChampionIds.value,
    ...enemyLockedIds.value
  ])
  return allChampionIds.value.filter(id => !taken.has(id))
})

// 选人阶段敌方锁定后触发候选池懒加载（数据源就绪后 watch 重算推荐）
watch(
  () => [sessionData.phase, enemyLockedIds.value.length] as const,
  ([phase, n]) => {
    if (phase === 'ChampSelect' && n > 0) void ensureChampionOptions()
  },
  { immediate: true }
)

/**
 * 最后一次选人期快照。
 *
 * 离开选人期后后端不再下发 champSelect，sessionData.champSelect 会被 undefined 覆盖，
 * 但 ban 条与阶段条要留着供对局中/赛后回看，故前端自留一份。
 */
const lastChampSelect = ref<ChampSelect | undefined>(undefined)

// 新一局进入选人期时，新的 champSelect 数据还没到达——这个窗口里若不清掉快照，
// 横幅会误显示上一局的 ban（比什么都不显示更糟：用户会以为那是本局的）。
// phase 一变成 ChampSelect 立即清空，等新数据到达后由下面的 watch 重新填入。
watch(
  () => sessionData.phase,
  (newVal, oldVal) => {
    if (newVal === 'ChampSelect' && oldVal !== 'ChampSelect') {
      lastChampSelect.value = undefined
    }
  }
)

watch(
  () => sessionData.champSelect,
  cs => {
    if (cs !== undefined) lastChampSelect.value = cs
  }
)

/** 展示用 champSelect：实时数据优先，选人期结束后回退到最后一次快照，供离开选人期后继续展示阶段/ban 条 */
const displayChampSelect = computed(() => sessionData.champSelect ?? lastChampSelect.value)

/** 选人阶段结构化视图的 stage 字段（''=未知，驱动 stepper 是否展示） */
const champSelectStage = computed(() => displayChampSelect.value?.stage ?? '')
/** 当前 stage 在 STAGE_STEPS 中的下标，未匹配（如 '' 或非法值）时为 -1，stepper 各步均不高亮 */
const currentStageIndex = computed(() =>
  STAGE_STEPS.findIndex(s => s.key === champSelectStage.value)
)
/** 我方 / 敌方已 ban 英雄 id 列表，非选人期或无 ban 数据时为空数组 */
const myBans = computed(() => displayChampSelect.value?.myBans ?? [])
const theirBans = computed(() => displayChampSelect.value?.theirBans ?? [])
/** 任一方存在 ban 记录才展示 ban 条整块 */
const hasBans = computed(() => myBans.value.length > 0 || theirBans.value.length > 0)

/**
 * 横幅首段状态文案，随 sessionData.phase 变化（横幅不再限定选人期展示，见 Gaming.vue 模板）。
 * - `ChampSelect` → 选人中
 * - `GameStart` / `InProgress` → 对局中（`GameStart` 是选人结束到正式进圈前的过渡态，
 *   目前后端 `process_session_data` 的 `valid_phases` 未下发它，但 `useSessionSync`
 *   的重试/轮询逻辑仍多处按这个取值判断，这里一并纳入保持口径一致）
 * - `PreEndOfGame` / `EndOfGame` → 对局结束
 * - 其余取值（如 `Lobby`/`Matchmaking`/`ReadyCheck`）目前不会真正到达这里——
 *   `.gaming-page` 只在 `sessionData.phase` 非空时渲染，而后端只在上述四个阶段才会
 *   下发非空 phase，这里仅作防御性兜底：不编造一个无法验证含义的状态词，
 *   直接不给前缀，只显示 `typeCn`
 */
const bannerPhaseLabel = computed(() => {
  switch (sessionData.phase) {
    case 'ChampSelect':
      return '选人中'
    case 'GameStart':
    case 'InProgress':
      return '对局中'
    case 'PreEndOfGame':
    case 'EndOfGame':
      return '对局结束'
    default:
      return ''
  }
})

/** OP.GG 数据状态（版本号/是否滞后），驱动选人期数据横幅 */
const opggStatus = ref<OpggStatus | null>(null)
watch(opggMode, m => getOpggStatus(m).then(s => (opggStatus.value = s)), { immediate: true })

/**
 * 选人期 BP 决策预告。与 useSessionSync 平行——决策快照是会话级单例、
 * 一次算完、纯展示，不进 per-player 的同步链。
 */
const bp = useBpDecision(() => sessionData.phase)

const router = useRouter()

/** 我的分路，取自会话里标着「我」的那名玩家；ARAM 等无分路模式为 null */
const myPosition = computed<Position | null>(() => {
  const me = orderedSubteams.value
    .flatMap(s => s.players)
    .find(p => p.summoner.puuid === mySummonerPuuid.value)
  const p = me?.assignedPosition?.toLowerCase()
  return p === 'top' || p === 'jungle' || p === 'middle' || p === 'bottom' || p === 'utility'
    ? p
    : null
})

const showConfig = ref(false)
const matchCount = ref(4)
const message = useMessage()

const { tier: opggTier, loading: opggTierLoading, loadTier, switchTier } = useOpggTier()
onMounted(loadTier)

/**
 * 段位切换。成功后补刷 opggStatus——换段位可能连补丁号一起变，
 * 横幅上的版本号不跟着更新就会和卡片数据对不上。
 */
const onTierChange = async (next: OpggTier) => {
  const ok = await switchTier(next)
  if (ok) {
    opggStatus.value = await getOpggStatus(opggMode.value)
  } else {
    message.error('段位数据拉取失败，已保持原段位显示')
  }
}

const showAITooltip = ref(false)

/** AI 功能提示状态（内存中存储，每次打开软件只提示一次） */
let hasShownAITip = false

/**
 * AI 分析状态。面板显隐与请求生命周期是分开的两件事——按钮只管「打开面板」，
 * 关掉面板后随时能点回来看进度或已有结果，不会白烧一次调用。见
 * {@link useGamingAIAnalysis}。
 *
 * 选人期跑 prompt 前注入确定性事实：规则引擎决策（useBpDecision 快照）+ 双方
 * 阵容强度分（useLineupScore 按已锁定英雄聚合 OP.GG meta）。AI 只做解释层——
 * 引用这些数字，不得改写。
 */
const lineupScores = useLineupScore(sessionData, opggMode, {
  includePlayerProfiles: true,
  prefetchProfiles: true
})
const ai = useGamingAIAnalysis(sessionData, opggMode, {
  champSelectExtras: () => ({
    bpDecision: bp.decision.value,
    lineup: {
      mine: lineupScores.scores.value.mine,
      enemy: lineupScores.scores.value.enemy
    },
    matchup: lineupScores.scores.value.matchupHints,
    junglePatternLines: lineupScores.scores.value.junglePatternLine
      ? [lineupScores.scores.value.junglePatternLine]
      : null
  })
})

/**
 * 对局中实时分析（D-P2 对局中 tab）。
 *
 * 与 {@link useGamingAIAnalysis} 平行：对局中自动轮询 liveclientdata 快照，
 * 分析前先经 liveGameIntel 确定性聚合，AI 只引用不改写。赛前/赛后无实时数据
 * 时该 tab 展示「当前不在对局中」，轮询与限流由 composable 自管。
 */
const live = useLiveAIAnalysis(sessionData, { mySummoner })

/** AI 面板的 tab 结构（D-P2 三 tab）：选人期 / 对局中 / 赛后 */
type AiTab = 'champSelect' | 'live' | 'game'
const aiTab = ref<AiTab>('champSelect')

/** 按当前阶段决定面板默认打开的 tab；其余阶段（含兜底）一律赛后 */
const defaultAiTab = computed<AiTab>(() => {
  if (sessionData.phase === 'ChampSelect') return 'champSelect'
  if (sessionData.phase === 'InProgress' || sessionData.phase === 'GameStart') return 'live'
  return 'game'
})

/** 面板标题随当前 tab 变化 */
const aiPanelTitle = computed(() =>
  aiTab.value === 'champSelect'
    ? '选人期阵容分析'
    : aiTab.value === 'live'
      ? '对局中实时分析'
      : '赛后复盘'
)

/** 各 tab 独立渲染（kindState 按 kind 隔离，rendered 由报告渲染器统一转码） */
const champSelectRendered = computed(() =>
  renderAnalysisReport(ai.kindState.champSelect.result.value)
)
const gameRendered = computed(() => renderAnalysisReport(ai.kindState.game.result.value))
const liveUpdatedAt = computed(() =>
  live.lastPollAt.value
    ? new Date(live.lastPollAt.value).toLocaleTimeString('zh-CN', { hour12: false })
    : ''
)

/** 当前 tab 是否在进行中（决定「重新分析」按钮是否可点） */
const currentTabLoading = computed(() =>
  aiTab.value === 'live' ? live.loading.value : ai.kindState[aiTab.value].loading.value
)

/**
 * AI 按钮入口：打开面板并切到当前阶段对应的 tab；面板里没东西可看才自动发起
 * （live 走 useLiveAIAnalysis 的 ensureStarted，其余走 ai.openPanel 的限流逻辑）。
 */
function handleOpenPanel(): void {
  const tab = defaultAiTab.value
  aiTab.value = tab
  ai.showPanel.value = true
  if (tab === 'live') live.ensureStarted()
  else ai.openPanel()
}

/** 面板内「重新分析」：只重跑当前 tab 对应的分析（不限流） */
function rerunCurrentTab(): void {
  if (aiTab.value === 'live') void live.rerun()
  else void ai.rerunKind(aiTab.value)
}

/** 存规则进行中标志：防连点导致两次 reload 同一基线、后写覆盖先写丢规则 */
const savingRule = ref(false)

/**
 * 把当前决策固化成一条规则并跳转到配置页。
 *
 * 选人期只读、不提供就地编辑——30 秒窗口内改配置不现实。
 */
async function handleSaveRule(): Promise<void> {
  if (savingRule.value) return
  const d = bp.decision.value
  if (!d) return
  const draft = buildRuleDraft({
    decision: d,
    myPosition: myPosition.value,
    championName: getChampionName
  })
  if (!draft) {
    message.warning('当前没有可保存的目标')
    return
  }

  savingRule.value = true
  try {
    // ban 阶段没人 hover 过任何英雄时，英雄名缓存可能从未被触发加载
    // （ChampionIntelCard 只在有人 hover 后才加载）——存规则前先兜底加载一次，
    // 避免把「对位英雄60」这种占位文案写进持久化规则名。loadChampionNames
    // 本身幂等（缓存非空时立即返回），重复调用无副作用。
    await loadChampionNames()
    // 必须先 reload——usePickRules/useBanRules 每次调用都返回全新的空 ref，
    // 直接 save 会把已有规则整个清掉。
    if (d.action_type === 'Ban') {
      const { rules, reload, save } = useBanRules()
      await reload()
      await save([...rules.value, draft as BanRule])
    } else {
      const { rules, reload, save } = usePickRules()
      await reload()
      await save([...rules.value, draft as PickRule])
    }

    message.success(`已存为规则「${draft.name}」`)
    await router.push('/Settings/Automation')
  } catch (e) {
    message.error('保存规则失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    savingRule.value = false
  }
}

const handleUpdateConfig = async (value: number | null) => {
  if (!value) return
  try {
    await putConfigByIpc('matchHistoryCount', value)
    // 立即重拉 session，让新 matchHistoryCount 立刻生效（无需等下局）
    await requestSessionData()
    message.success('设置已保存，已刷新当前对局数据')
  } catch (e) {
    message.error('保存失败')
  }
}

onMounted(async () => {
  try {
    const val = await getConfigByIpc<number>('matchHistoryCount')
    if (typeof val === 'number') {
      matchCount.value = val
    }
  } catch (e) {
    console.error(e)
  }

  // 英雄名缓存懒加载：此前只有 ChampionIntelCard 在有人 hover 后才触发，
  // 导致 ban 阶段（尚无人 hover）整段时间决策带只能显示「英雄157」占位符。
  // 提前在页面挂载时触发一次，幂等（已加载时立即返回）。
  void loadChampionNames()

  // 每次打开软件只展示一次 AI 功能提示
  if (!hasShownAITip) {
    setTimeout(() => {
      showAITooltip.value = true
      hasShownAITip = true
      setTimeout(() => {
        showAITooltip.value = false
      }, 5000)
    }, 2000)
  }

  // OP.GG 数据兜底刷新：后端启动已预热，此处 fire-and-forget 兜底软件长开超 12h 未重启的场景。
  // 两个模式都刷新完成后，重新拉取当前模式状态以更新横幅（版本号/滞后标记跟着变化）。
  void Promise.all([ensureOpggData('ranked'), ensureOpggData('aram')]).then(() =>
    getOpggStatus(opggMode.value).then(s => (opggStatus.value = s))
  )
})
</script>

<style lang="css" scoped>
.gaming-page {
  padding: var(--space-16);
  /* 右缘悬浮按钮（设置/AI）占一条竖向通道，多留白避免压在卡片内容上 */
  padding-right: calc(var(--space-16) + 40px);
  height: 100%;
  box-sizing: border-box;
  position: relative;
  overflow-y: auto;
}

.gaming-config-btn {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 100;
  opacity: 0.6;
}

.gaming-ai-btn {
  position: absolute;
  right: 0;
  top: calc(50% + 50px);
  transform: translateY(-50%);
  z-index: 100;
  opacity: 0.6;
}

.gaming-config-hint {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.gaming-intel-banner {
  margin-bottom: var(--space-8);
}

.banner-main {
  text-align: center;
  font-size: 12px;
  opacity: 0.7;
}

/* stage 非空时：左 stepper、右数据源信息并排 */
.banner-main-split {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  text-align: left;
}

.banner-meta {
  white-space: nowrap;
}

/* 横幅是辅助信息密度，下拉必须收窄，否则压垮整行版式 */
.banner-tier-select {
  display: inline-block;
  width: 96px;
  margin-left: var(--space-8);
  vertical-align: middle;
}

.banner-stale {
  /* 品牌 token 名为 --semantic-loss（无对应 --semantic-lose 定义） */
  color: var(--semantic-loss);
}

/* ---- 阶段 stepper：预选/禁用/选人/确认，当前步高亮，切换带 transition ---- */
.stage-stepper {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stage-step {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-tertiary);
  font-size: 12px;
  transition: color var(--dur-normal) var(--ease-expo);
}

.stage-step-active {
  color: var(--semantic-win);
  font-weight: 600;
}

.stage-step-done {
  color: var(--text-secondary, var(--text-tertiary));
}

.stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition:
    background-color var(--dur-normal) var(--ease-expo),
    box-shadow var(--dur-normal) var(--ease-expo);
}

.stage-step-active .stage-dot {
  background: var(--semantic-win);
  box-shadow: 0 0 6px 1px rgba(61, 155, 122, 0.55);
}

.stage-step-done .stage-dot {
  background: var(--semantic-win);
  opacity: 0.5;
}

.stage-connector {
  width: 16px;
  height: 1px;
  background: var(--border-subtle);
  transition: background-color var(--dur-normal) var(--ease-expo);
}

.stage-connector-done {
  background: var(--semantic-win);
  opacity: 0.5;
}

/* ---- 双方 ban 条：位于 stepper 下、grid 上 ---- */
.ban-bar {
  display: flex;
  gap: var(--space-24);
  margin-top: var(--space-8);
  font-size: 12px;
}

.ban-group {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.ban-group-label {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.ban-group-empty {
  color: var(--text-tertiary);
}

.ban-icons {
  display: flex;
  gap: 4px;
}

.ban-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  filter: grayscale(1) brightness(0.7);
  border: 1px solid rgba(196, 92, 92, 0.5);
  /* 新 ban 弹入：仅在元素首次挂载时播放一次（列表增长时旧图标不会重新触发） */
  animation: ban-pop 0.24s var(--ease-expo) both;
}

@keyframes ban-pop {
  from {
    opacity: 0;
    transform: scale(0.75);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ban-icon {
    animation: none;
  }
}

.ai-result-content {
  padding: var(--space-16);
  line-height: 1.8;
  font-size: var(--font-size-md);
  max-height: 600px;
  overflow-y: auto;
}

/* 首块文本到达前的占位：与 MatchAIPanel 的骨架屏同一形态 */
.ai-result-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-16);
}

.ai-result-skeleton-label {
  font-size: var(--font-size-md);
  color: var(--text-secondary);
  padding-bottom: var(--space-6);
}

.ai-result-empty {
  padding: var(--space-24) var(--space-16);
  text-align: center;
  color: var(--text-secondary);
}

/* 对局中 tab：实时数据更新的提示条（轮询是自管的，这里只做状态展示） */
.ai-live-hint {
  padding: var(--space-8) var(--space-16);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

/* 报告内容样式（章节着色 / hero / 数字名字高亮）由共享 styles/ai-report.css 提供，
   容器同时挂了 class `ai-report`，此处只保留弹窗布局。 */

.gaming-grid {
  height: 100%;
  display: grid;
  /* auto-fit: 窄屏 (<1000px) 自动堆 1 列, 宽屏 2 列, 自适应 */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr));
  /* 整体居中, 4K 下 2600 max 保证 card 有横向空间放大 */
  max-width: 2600px;
  margin: 0 auto;
  gap: var(--space-16);
}

/* 每列：BestPicksPanel 置于 SubteamCard 正上方，纵向排布撑满 */
.subteam-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  height: 100%;
}

.subteam-col > :last-child {
  flex: 1;
  min-height: 0;
}

.gaming-grid-multi {
  height: auto;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr));
  grid-auto-rows: minmax(220px, auto);
  max-width: 2600px;
}

.matchup-hints {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.matchup-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 1px 8px;
  border-radius: 6px;
  background: var(--glass-bg-mid);
}

.jungle-pattern {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 1px 8px;
  margin-top: 4px;
  border-radius: 6px;
  background: var(--glass-bg-mid);
  border-left: 2px solid var(--accent, rgba(255, 200, 80, 0.6));
}
</style>
