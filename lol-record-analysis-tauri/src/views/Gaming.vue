<template>
  <template v-if="!sessionData.phase">
    <LoadingComponent>等待加入游戏...</LoadingComponent>
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
            :disabled="!sessionData.phase || sessionData.phase === 'ChampSelect'"
            @click="handleAIAnalysis"
          >
            <template #icon>
              <n-icon><sparkles-outline /></n-icon>
            </template>
          </n-button>
        </template>
        ✨ AI分析功能：点击可智能分析双方阵容和玩家战绩
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
      <n-modal v-model:show="showAIResult" preset="card" title="AI 分析" style="width: 600px">
        <div class="ai-result-content ai-report" v-html="renderedAIResult"></div>
      </n-modal>

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
        />
      </div>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { SettingsOutline, SparklesOutline } from '@vicons/ionicons5'
import { useMessage } from 'naive-ui'

import LoadingComponent from '@renderer/components/LoadingComponent.vue'
import SubteamCard from '@renderer/components/gaming/SubteamCard.vue'
import { analyzeGameWithAIStream, type StreamCallbacks } from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { useSessionSync } from '@renderer/composables/useSessionSync'
import { useSessionTiers } from '@renderer/composables/useSessionTiers'

const { sessionData, requestSessionData } = useSessionSync()
const tiersBySubteam = useSessionTiers(sessionData)

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
    await analyzeGameWithAIStream(sessionData, 'team', callbacks)
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
})
</script>

<style lang="css" scoped>
.gaming-page {
  padding: var(--space-16);
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
