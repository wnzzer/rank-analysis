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
          <n-button
            circle
            secondary
            type="info"
            class="gaming-ai-btn"
            :loading="aiLoading"
            :disabled="!sessionData.phase"
            @click="handleAIAnalysis"
          >
            <template #icon>
              <n-icon><sparkles-outline /></n-icon>
            </template>
          </n-button>
        </template>
        ✨ AI分析功能：选人阶段分析阵容情报，对局中分析双方阵容和玩家战绩
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

      <!-- AI 分析结果弹窗 -->
      <n-modal
        v-model:show="showAIResult"
        preset="card"
        :title="aiResultTitle"
        style="width: 600px"
      >
        <div class="ai-result-content ai-report" v-html="renderedAIResult"></div>
      </n-modal>

      <div v-if="sessionData.phase === 'ChampSelect'" class="gaming-intel-banner">
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
            选人中 · {{ sessionData.typeCn }}
            <template v-if="opggStatus">
              · OP.GG {{ opggStatus.patch
              }}<span v-if="opggStatus.stale" class="banner-stale">（数据滞后）</span>
            </template>
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
      </div>

      <div class="gaming-grid" :class="{ 'gaming-grid-multi': sessionData.isMultiTeam }">
        <SubteamCard
          v-for="st of orderedSubteams"
          :key="`subteam-${st.subteamId}`"
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
        />
      </div>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { SettingsOutline, SparklesOutline } from '@vicons/ionicons5'
import { useMessage } from 'naive-ui'

import LoadingComponent from '@renderer/components/LoadingComponent.vue'
import SubteamCard from '@renderer/components/gaming/SubteamCard.vue'
import {
  analyzeChampSelectWithAIStream,
  analyzeGameWithAIStream,
  type StreamCallbacks
} from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { useSessionSync } from '@renderer/composables/useSessionSync'
import { useSessionTiers } from '@renderer/composables/useSessionTiers'
import { useGameState } from '@renderer/composables/useGameState'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import {
  ensureOpggData,
  getOpggStatus,
  queueIdToOpggMode,
  type OpggStatus
} from '@renderer/services/opgg'

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

/** 选人阶段结构化视图的 stage 字段（''=未知，驱动 stepper 是否展示） */
const champSelectStage = computed(() => sessionData.champSelect?.stage ?? '')
/** 当前 stage 在 STAGE_STEPS 中的下标，未匹配（如 '' 或非法值）时为 -1，stepper 各步均不高亮 */
const currentStageIndex = computed(() =>
  STAGE_STEPS.findIndex(s => s.key === champSelectStage.value)
)
/** 我方 / 敌方已 ban 英雄 id 列表，非选人期或无 ban 数据时为空数组 */
const myBans = computed(() => sessionData.champSelect?.myBans ?? [])
const theirBans = computed(() => sessionData.champSelect?.theirBans ?? [])
/** 任一方存在 ban 记录才展示 ban 条整块 */
const hasBans = computed(() => myBans.value.length > 0 || theirBans.value.length > 0)

/** OP.GG 数据状态（版本号/是否滞后），驱动选人期数据横幅 */
const opggStatus = ref<OpggStatus | null>(null)
watch(opggMode, m => getOpggStatus(m).then(s => (opggStatus.value = s)), { immediate: true })

const showConfig = ref(false)
const matchCount = ref(4)
const message = useMessage()

const aiLoading = ref(false)
const aiResult = ref('')
const showAIResult = ref(false)
const showAITooltip = ref(false)

/** AI 功能提示状态（内存中存储，每次打开软件只提示一次） */
let hasShownAITip = false

const renderedAIResult = computed(() => renderAnalysisReport(aiResult.value))
/** 弹窗标题：选人期是「阵容分析」，对局中/赛后沿用旧的「AI 分析」 */
const aiResultTitle = computed(() =>
  sessionData.phase === 'ChampSelect' ? '选人期阵容分析' : 'AI 分析'
)

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

const handleAIAnalysis = async () => {
  if (aiLoading.value) return

  aiLoading.value = true
  aiResult.value = ''
  showAIResult.value = true

  try {
    const callbacks: StreamCallbacks = {
      onChunk: chunk => {
        aiResult.value += chunk
      },
      onDone: () => {
        aiLoading.value = false
      },
      onError: error => {
        message.error('AI 分析出错: ' + error)
        aiLoading.value = false
      }
    }
    if (sessionData.phase === 'ChampSelect') {
      await analyzeChampSelectWithAIStream(sessionData, opggMode.value, callbacks)
    } else {
      await analyzeGameWithAIStream(sessionData, 'team', callbacks, { opggMode: opggMode.value })
    }
  } catch (e: any) {
    message.error('AI 分析出错: ' + (e.message || '未知错误'))
    aiLoading.value = false
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

.gaming-grid-multi {
  height: auto;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr));
  grid-auto-rows: minmax(220px, auto);
  max-width: 2600px;
}
</style>
