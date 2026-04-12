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
        <div class="ai-result-content" v-html="renderedAIResult"></div>
      </n-modal>

      <!-- 左我方、右敌方，由后端按 LCU 当前用户交换保证 -->
      <n-flex justify="space-between" class="gaming-columns">
        <n-flex vertical class="gaming-team-col gaming-team-blue">
          <div class="team-label team-label-blue">我方</div>
          <PlayerCard
            v-for="(sessionSummoner, i) of sessionData.teamOne"
            :key="'teamOne' + i"
            :style="{ '--stagger-i': i }"
            team="blue"
            :session-summoner="sessionSummoner"
            :mode-type="sessionData.type"
            :type-cn="sessionData.typeCn"
            :queue-id="sessionData.queueId"
            :img-url="comImgTier.teamOne[i]?.imgUrl"
            :tier-cn="comImgTier.teamOne[i]?.tierCn"
          />
        </n-flex>

        <n-flex vertical class="gaming-team-col gaming-team-red">
          <div class="team-label team-label-red">敌方</div>
          <!-- 选英雄阶段不显示敌方具体玩家，显示「选择中」 -->
          <template v-if="sessionData.phase === 'ChampSelect'">
            <div class="enemy-placeholder">
              <n-text depth="2">选择中</n-text>
            </div>
          </template>
          <template v-else>
            <PlayerCard
              v-for="(sessionSummoner, i) of sessionData.teamTwo"
              :key="'teamTwo' + i"
              :style="{ '--stagger-i': i }"
              team="red"
              :session-summoner="sessionSummoner"
              :mode-type="sessionData.type"
              :type-cn="sessionData.typeCn"
              :queue-id="sessionData.queueId"
              :img-url="comImgTier.teamTwo[i]?.imgUrl"
              :tier-cn="comImgTier.teamTwo[i]?.tierCn"
            />
          </template>
        </n-flex>
      </n-flex>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { SettingsOutline, SparklesOutline } from '@vicons/ionicons5'
import { useMessage } from 'naive-ui'

import unranked from '../assets/imgs/tier/unranked.png'
import bronze from '../assets/imgs/tier/bronze.png'
import silver from '../assets/imgs/tier/silver.png'
import gold from '../assets/imgs/tier/gold.png'
import platinum from '../assets/imgs/tier/platinum.png'
import diamond from '../assets/imgs/tier/diamond.png'
import master from '../assets/imgs/tier/master.png'
import grandmaster from '../assets/imgs/tier/grandmaster.png'
import challenger from '../assets/imgs/tier/challenger.png'
import iron from '../assets/imgs/tier/iron.png'
import emerald from '../assets/imgs/tier/emerald.png'
import LoadingComponent from '../components/LoadingComponent.vue'
import PlayerCard from '../components/gaming/PlayerCard.vue'
import { SessionData, SessionSummoner, PreGroupMarkers } from '../components/gaming/type'
import { divisionOrPoint } from '../components/composition'
import { analyzeGameWithAIStream, type StreamCallbacks } from '../services/ai'
import MarkdownIt from 'markdown-it'
/**
 * Returns the image path for the given rank tier.
 * This function dynamically requires the image based on the provided tier string,
 * converting it to lowercase to ensure correct file name matching.
 *
 * @param {string} tier - The rank tier to get the image for.
 * @returns {string} - The path to the rank tier image.
 */
interface ComImgTier {
  teamOne: { imgUrl: string; tierCn: string }[]
  teamTwo: { imgUrl: string; tierCn: string }[]
}

const comImgTier = computed(() => {
  const comImgTier: ComImgTier = {
    teamOne: [],
    teamTwo: []
  }

  const tierImages: { [key: string]: any } = {
    unranked: unranked,
    bronze: bronze,
    silver: silver,
    gold: gold,
    platinum: platinum,
    diamond: diamond,
    master: master,
    grandmaster: grandmaster,
    challenger: challenger,
    iron: iron,
    emerald: emerald
  }

  // 处理 teamOne（我方）
  for (const sessionSummoner of sessionData.teamOne) {
    let tierNormalized = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier
      ? tierImages[sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase()]
      : unranked

    if (
      sessionData.type === 'RANKED_FLEX_SR' &&
      sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier
    ) {
      tierNormalized =
        tierImages[sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase()]
    }

    let tierCn = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn
      ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2) +
        ' ' +
        divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_SOLO_5x5)
      : '无'

    if (
      sessionData.type === 'RANKED_FLEX_SR' &&
      sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn
    ) {
      tierCn =
        sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2) +
        ' ' +
        divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_FLEX_SR)
    }

    comImgTier.teamOne.push({
      imgUrl: tierNormalized,
      tierCn: tierCn
    })
  }

  // 处理 teamTwo（敌方）
  for (const sessionSummoner of sessionData.teamTwo) {
    let tierNormalized = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier
      ? tierImages[sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase()]
      : unranked

    if (
      sessionData.type === 'RANKED_FLEX_SR' &&
      sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier
    ) {
      tierNormalized =
        tierImages[sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase()]
    }

    let tierCn = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn
      ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2) +
        ' ' +
        divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_SOLO_5x5)
      : '无'

    if (
      sessionData.type === 'RANKED_FLEX_SR' &&
      sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn
    ) {
      tierCn =
        sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2) +
        ' ' +
        divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_FLEX_SR)
    }

    comImgTier.teamTwo.push({
      imgUrl: tierNormalized,
      tierCn: tierCn
    })
  }

  return comImgTier
})

const showConfig = ref(false)
const matchCount = ref(4)
const message = useMessage()

// AI 分析相关
const aiLoading = ref(false)
const aiResult = ref('')
const showAIResult = ref(false)
const showAITooltip = ref(false)

// AI 功能提示状态（内存中存储，每次打开软件只提示一次）
let hasShownAITip = false

// Markdown 渲染器
const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true
})

// 渲染后的 AI 结果（Markdown -> HTML）
const renderedAIResult = computed(() => {
  if (!aiResult.value) return ''
  return md.render(aiResult.value)
})

const handleUpdateConfig = async (value: number | null) => {
  if (!value) return
  try {
    await invoke('put_config', { key: 'matchHistoryCount', value })
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
  }
}

// AI 分析处理（流式）
const handleAIAnalysis = async () => {
  if (aiLoading.value) return

  aiLoading.value = true
  aiResult.value = ''
  showAIResult.value = true

  try {
    const callbacks: StreamCallbacks = {
      onChunk: (chunk: string) => {
        aiResult.value += chunk
      },
      onDone: () => {
        aiLoading.value = false
      },
      onError: (error: string) => {
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
    const val = await invoke('get_config', { key: 'matchHistoryCount' })
    if (typeof val === 'number') {
      matchCount.value = val
    } else if (typeof val === 'string' && val) {
      matchCount.value = parseInt(val) || 4
    }
  } catch (e) {
    console.error(e)
  }
})

const sessionData = reactive<SessionData>({
  phase: '',
  type: '',
  typeCn: '',
  queueId: 0,
  teamOne: [],
  teamTwo: []
})

let unlistenSessionComplete: (() => void) | null = null
let unlistenSessionBasicInfo: (() => void) | null = null
let unlistenSessionPreGroup: (() => void) | null = null
let unlistenPlayerUpdateTeamOne: (() => void) | null = null
let unlistenPlayerUpdateTeamTwo: (() => void) | null = null
let unlistenSessionError: (() => void) | null = null

function updatePreGroupMarkers(team: SessionSummoner[], markers: Record<string, PreGroupMarkers>) {
  for (const player of team) {
    const marker = markers[player.summoner.puuid]
    if (marker) {
      if (JSON.stringify(player.preGroupMarkers) !== JSON.stringify(marker)) {
        player.preGroupMarkers = marker
      }
    }
  }
}

function updatePlayerAtIndex(team: SessionSummoner[], index: number, newPlayer: SessionSummoner) {
  if (!team || index >= team.length) return

  const oldPlayer = team[index]

  // 如果是同一个玩家，保留那些在后端最后阶段才计算的字段（meetGames, preGroupMarkers）
  // 因为 session-player-update 事件中的这些字段是空的，直接覆盖会导致闪烁
  if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
    newPlayer.meetGames = oldPlayer.meetGames
    newPlayer.preGroupMarkers = oldPlayer.preGroupMarkers
  }

  team[index] = newPlayer
}

function updateBasicInfo(currentTeam: SessionSummoner[], newTeam: SessionSummoner[]) {
  if (!newTeam || newTeam.length === 0) return

  // 基础信息更新：只更新名字、英雄等，保留段位和战绩
  for (let i = 0; i < newTeam.length; i++) {
    const newPlayer = newTeam[i]

    if (i < currentTeam.length) {
      const oldPlayer = currentTeam[i]

      // 如果是同一个玩家
      if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
        // 只更新基础字段
        oldPlayer.championId = newPlayer.championId
        oldPlayer.championKey = newPlayer.championKey
        oldPlayer.summoner = newPlayer.summoner
        // 保持 rank, matchHistory, userTag, meetGames 等不变
      } else {
        // 玩家变了，直接替换（此时会丢失 rank，但这是正确的，因为是新玩家）
        currentTeam[i] = newPlayer
      }
    } else {
      currentTeam.push(newPlayer)
    }
  }

  // 移除多余的
  if (currentTeam.length > newTeam.length) {
    currentTeam.splice(newTeam.length)
  }
}

function updateTeamData(currentTeam: SessionSummoner[], newTeam: SessionSummoner[]) {
  // 如果新数据为空，清空当前数据
  if (!newTeam || newTeam.length === 0) {
    if (currentTeam.length > 0) {
      currentTeam.splice(0, currentTeam.length)
    }
    return
  }

  // 更新或添加元素
  for (let i = 0; i < newTeam.length; i++) {
    const newPlayer = newTeam[i]

    if (i < currentTeam.length) {
      const oldPlayer = currentTeam[i]

      // 逻辑判断：是否需要更新
      let shouldUpdate = true

      if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
        // 如果新数据是加载中，但旧数据已经加载完成，则保留旧数据（不更新）
        if (newPlayer.isLoading && !oldPlayer.isLoading) {
          shouldUpdate = false
        }
        // 如果数据完全一致，则保留旧数据（不更新）
        else if (JSON.stringify(newPlayer) === JSON.stringify(oldPlayer)) {
          shouldUpdate = false
        }
      }

      if (shouldUpdate) {
        currentTeam[i] = newPlayer
      }
    } else {
      // 超出当前长度，直接添加
      currentTeam.push(newPlayer)
    }
  }

  // 如果当前长度多于新数据长度，移除多余部分
  if (currentTeam.length > newTeam.length) {
    currentTeam.splice(newTeam.length)
  }
}

onMounted(async () => {
  console.log('🔧 [DEBUG] Gaming page mounting...')

  // 显示 AI 功能提示（每次打开软件只显示一次）
  if (!hasShownAITip) {
    setTimeout(() => {
      showAITooltip.value = true
      hasShownAITip = true

      // 5秒后自动关闭提示
      setTimeout(() => {
        showAITooltip.value = false
      }, 5000)
    }, 2000) // 页面加载2秒后显示提示
  }

  // 监听 session 完成事件
  unlistenSessionComplete = await listen<SessionData>('session-complete', event => {
    const data = event.payload
    console.log('📦 [DEBUG] Session complete received:', data)
    console.log('📊 [DEBUG] Data structure check:', {
      hasPhase: !!data.phase,
      phase: data.phase,
      hasType: !!data.type,
      type: data.type,
      teamOneLength: data.teamOne?.length || 0,
      teamTwoLength: data.teamTwo?.length || 0,
      firstPlayerTeamOne: data.teamOne?.[0]?.summoner?.gameName || 'none'
    })

    if (data.phase) {
      console.log('✅ [DEBUG] Updating sessionData...')
      sessionData.phase = data.phase
      sessionData.type = data.type
      sessionData.typeCn = data.typeCn
      sessionData.queueId = data.queueId

      const newTeamOne = Array.isArray(data.teamOne) ? data.teamOne : []
      const newTeamTwo = Array.isArray(data.teamTwo) ? data.teamTwo : []

      updateTeamData(sessionData.teamOne, newTeamOne)
      updateTeamData(sessionData.teamTwo, newTeamTwo)

      console.log('✅ [DEBUG] SessionData updated:', {
        phase: sessionData.phase,
        type: sessionData.type,
        teamOneCount: sessionData.teamOne.length,
        teamTwoCount: sessionData.teamTwo.length
      })
    } else {
      console.warn('⚠️ [DEBUG] Received empty data (not in game)')
    }
  })

  // 监听基础信息更新事件
  unlistenSessionBasicInfo = await listen<SessionData>('session-basic-info', event => {
    const data = event.payload
    console.log('📦 [DEBUG] Session basic info received, data:', data)

    if (data.phase) {
      sessionData.phase = data.phase
      sessionData.type = data.type
      sessionData.typeCn = data.typeCn
      sessionData.queueId = data.queueId

      const newTeamOne = Array.isArray(data.teamOne) ? data.teamOne : []
      const newTeamTwo = Array.isArray(data.teamTwo) ? data.teamTwo : []

      updateBasicInfo(sessionData.teamOne, newTeamOne)
      updateBasicInfo(sessionData.teamTwo, newTeamTwo)
    }
  })

  // 监听预组队信息更新
  unlistenSessionPreGroup = await listen<Record<string, PreGroupMarkers>>(
    'session-pre-group',
    event => {
      const markers = event.payload
      console.log('📦 [DEBUG] Session pre-group markers received:', markers)
      updatePreGroupMarkers(sessionData.teamOne, markers)
      updatePreGroupMarkers(sessionData.teamTwo, markers)
    }
  )

  // 监听玩家更新事件（队伍一）
  unlistenPlayerUpdateTeamOne = await listen('session-player-update-team-one', (event: any) => {
    const { index, total, player } = event.payload
    console.log(`✅ Player ${index + 1}/${total} (Team One) loaded:`, player.summoner.gameName)
    updatePlayerAtIndex(sessionData.teamOne, index, player)
  })

  // 监听玩家更新事件（队伍二）
  unlistenPlayerUpdateTeamTwo = await listen('session-player-update-team-two', (event: any) => {
    const { index, total, player } = event.payload
    console.log(`✅ Player ${index + 1}/${total} (Team Two) loaded:`, player.summoner.gameName)
    updatePlayerAtIndex(sessionData.teamTwo, index, player)
  })

  // 监听错误事件
  unlistenSessionError = await listen<string>('session-error', event => {
    console.error('❌ Session error:', event.payload)
  })

  console.log('✅ [DEBUG] All event listeners registered')

  // 第一次请求
  console.log('🔧 [DEBUG] Requesting initial session data...')
  await requestSessionData()

  console.log('✅ [DEBUG] Gaming page fully mounted')
})

// 重试机制变量
let retryCount = 0
const maxRetries = 3

async function checkAndRetryFetch() {
  if (sessionData.phase === 'InProgress' || sessionData.phase === 'GameStart') {
    // 如果敌方队伍为空或没有召唤师数据（例如名字为空），则重试
    const enemyMissing =
      !sessionData.teamTwo ||
      sessionData.teamTwo.length === 0 ||
      sessionData.teamTwo.every(p => !p.summoner.gameName)

    if (enemyMissing && retryCount < maxRetries) {
      retryCount++
      console.log(`⚠️ [DEBUG] 游戏中敌方数据缺失 (尝试 ${retryCount}/${maxRetries}), 3秒后重试...`)
      setTimeout(() => {
        requestSessionData()
        // 获取后再检查一次
        setTimeout(checkAndRetryFetch, 4000)
      }, 3000)
    }
  }
}

// 监听阶段变化以重置重试计数
import { watch } from 'vue'
watch(
  () => sessionData.phase,
  (newVal, oldVal) => {
    if (newVal === 'InProgress' && oldVal !== 'InProgress') {
      retryCount = 0
      // 状态切换后给 LCU 一点时间填充数据
      setTimeout(checkAndRetryFetch, 2000)
    }
  }
)

onUnmounted(() => {
  // 清理所有事件监听器
  if (unlistenSessionComplete) {
    unlistenSessionComplete()
  }
  if (unlistenSessionBasicInfo) {
    unlistenSessionBasicInfo()
  }
  if (unlistenSessionPreGroup) {
    unlistenSessionPreGroup()
  }
  if (unlistenPlayerUpdateTeamOne) {
    unlistenPlayerUpdateTeamOne()
  }
  if (unlistenPlayerUpdateTeamTwo) {
    unlistenPlayerUpdateTeamTwo()
  }
  if (unlistenSessionError) {
    unlistenSessionError()
  }

  // 清理定时器

  console.log('🧹 Gaming page unmounted, cleaned up listeners')
})

async function requestSessionData() {
  try {
    console.log('📡 [DEBUG] Invoking get_session_data...')
    // 调用 Tauri 命令，后端会通过事件推送数据
    await invoke('get_session_data')
    console.log('✅ [DEBUG] get_session_data invoked successfully')
  } catch (error) {
    console.error('❌ [DEBUG] Failed to request session data:', error)
  }
}
</script>
<style lang="css" scoped>
.gaming-page {
  padding: var(--space-16);
  height: 100%;
  box-sizing: border-box;
  position: relative;
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
  font-size: 12px;
  color: var(--text-tertiary);
}

.ai-result-content {
  padding: var(--space-16);
  line-height: 1.8;
  font-size: 14px;
  max-height: 600px;
  overflow-y: auto;
}

/* 标题样式 */
.ai-result-content :deep(h1) {
  font-size: 20px;
  font-weight: 700;
  margin: 20px 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 3px solid var(--n-primary-color);
  color: var(--n-text-color);
}

.ai-result-content :deep(h2) {
  font-size: 18px;
  font-weight: 600;
  margin: 18px 0 10px 0;
  padding-left: 12px;
  border-left: 4px solid var(--n-primary-color);
  color: var(--n-text-color);
}

.ai-result-content :deep(h3) {
  font-size: 16px;
  font-weight: 600;
  margin: 14px 0 8px 0;
  color: var(--n-text-color);
}

/* 列表样式 */
.ai-result-content :deep(ul),
.ai-result-content :deep(ol) {
  padding-left: 24px;
  margin: 10px 0;
}

.ai-result-content :deep(li) {
  margin: 8px 0;
  line-height: 1.8;
}

/* 段落样式 */
.ai-result-content :deep(p) {
  margin: 10px 0;
}

/* 强调文本 */
.ai-result-content :deep(strong) {
  font-weight: 700;
  color: var(--n-primary-color);
}

/* 高亮标记 - 正面（绿色）*/
.ai-result-content :deep(mark) {
  background: linear-gradient(120deg, rgba(34, 197, 94, 0.2) 0%, rgba(34, 197, 94, 0.1) 100%);
  color: #22c55e;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

/* 行内代码 - 用于负面标签（红色）*/
.ai-result-content :deep(code) {
  background: linear-gradient(120deg, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.1) 100%);
  color: #ef4444;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
}

/* 引用块 */
.ai-result-content :deep(blockquote) {
  border-left: 4px solid var(--n-border-color);
  padding-left: 16px;
  margin: 12px 0;
  color: var(--n-text-color-3);
  font-style: italic;
}

/* 分隔线 */
.ai-result-content :deep(hr) {
  border: none;
  border-top: 2px solid var(--n-border-color);
  margin: 16px 0;
}

.gaming-columns {
  height: 100%;
  gap: var(--space-16);
}

.gaming-team-col {
  flex: 1;
  height: 100%;
  gap: var(--space-8);
  position: relative;
}

.team-label {
  font-size: 12px;
  font-weight: 700;
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  width: fit-content;
}

.team-label-blue {
  background: var(--team-blue);
  color: var(--text-primary);
  border: 1px solid rgba(59, 130, 246, 0.4);
}

.team-label-red {
  background: var(--team-red);
  color: var(--text-primary);
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.enemy-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  font-size: 14px;
}
</style>
