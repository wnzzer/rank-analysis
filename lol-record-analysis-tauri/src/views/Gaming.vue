<template>
  <template v-if="!sessionData.phase">
    <LoadingComponent>等待加入游戏...</LoadingComponent>
  </template>
  <template v-else>
    <div style="padding: 10px; height: 100vh; box-sizing: border-box; position: relative">
      <n-button
        circle
        secondary
        type="primary"
        style="
          position: absolute;
          right: 0px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 100;
          opacity: 0.5;
        "
        @click="showConfig = true"
        class="config-btn"
      >
        <template #icon>
          <n-icon><settings-outline /></n-icon>
        </template>
      </n-button>

      <n-modal v-model:show="showConfig" preset="card" title="显示设置" style="width: 400px">
        <n-form-item label="战绩显示数量">
          <n-input-number
            v-model:value="matchCount"
            :min="1"
            :max="20"
            @update:value="handleUpdateConfig"
          />
        </n-form-item>
        <span style="font-size: 12px; color: #999">设置将在下一次刷新或对局时生效</span>
      </n-modal>

      <n-flex justify="space-between" style="height: 100%; gap: 16px">
        <!-- 左侧部分 -->

        <n-flex vertical justify="space-between" style="gap: 8px; flex: 1; height: 100%">
          <PlayerCard
            v-for="(sessionSummoner, i) of sessionData.teamOne"
            :key="'teamOne' + i"
            :session-summoner="sessionSummoner"
            :mode-type="sessionData.type"
            :type-cn="sessionData.typeCn"
            :queue-id="sessionData.queueId"
            :img-url="comImgTier.teamOne[i]?.imgUrl"
            :tier-cn="comImgTier.teamOne[i]?.tierCn"
          ></PlayerCard>
        </n-flex>

        <!-- 右侧部分 -->
        <n-flex vertical justify="space-between" style="gap: 8px; flex: 1; height: 100%">
          <n-flex vertical justify="space-between" style="gap: 8px; flex: 1; height: 100%">
            <PlayerCard
              v-for="(sessionSummoner, i) of sessionData.teamTwo"
              :key="'teamTwo' + i"
              :session-summoner="sessionSummoner"
              :mode-type="sessionData.type"
              :type-cn="sessionData.typeCn"
              :queue-id="sessionData.queueId"
              :img-url="comImgTier.teamTwo[i]?.imgUrl"
              :tier-cn="comImgTier.teamTwo[i]?.tierCn"
            >
            </PlayerCard>
          </n-flex>
        </n-flex>
      </n-flex>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { SettingsOutline } from '@vicons/ionicons5'
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

  // 处理 teamOne
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

  // 处理 teamTwo
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

const handleUpdateConfig = async (value: number | null) => {
  if (!value) return
  try {
    await invoke('put_config', { key: 'matchHistoryCount', value })
    message.success('设置已保存')
  } catch (e) {
    message.error('保存失败')
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
let refreshTimer: ReturnType<typeof setInterval> | null = null

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
    console.log('📦 [DEBUG] Session basic info received')

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

  // 启动定时器，每5秒刷新一次
  refreshTimer = setInterval(async () => {
    console.log('🔄 [DEBUG] Auto refresh triggered')
    await requestSessionData()
  }, 5000)

  console.log('✅ [DEBUG] Gaming page fully mounted')
})

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
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }

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
.champion-img {
  width: 100%;
  /* 限制图片宽度不超过容器 */
  height: 100%;
  /* 限制图片高度不超过容器 */
  object-fit: cover;
  /* 保持图片的比例并裁剪溢出的部分 */
  display: inline-block;
}

.stats-title {
  font-weight: bold;
}

.stats-item {
  display: flex;
  justify-content: space-between;
}

.stats-label {
  font-size: 10px;

  color: #ccc;
}

.stats-value {
  font-size: 10px;
  color: #ffffff;
  /* 绿色表示积极数据 */
}

.recent-card {
  background: #28282b;
  /* 半透明背景 */
  border-radius: 8px;
  /* 圆角边框 */
  color: #fff;
  /* 白色字体 */
}
</style>
