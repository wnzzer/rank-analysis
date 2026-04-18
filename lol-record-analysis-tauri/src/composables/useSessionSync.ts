/**
 * 对局会话数据同步：订阅 LCU 推送事件 + 增量合并玩家数据
 * 从 Gaming.vue 中抽出，统一管理生命周期
 */

import { onMounted, onUnmounted, reactive, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { PreGroupMarkers, SessionData, SessionSummoner } from '@renderer/types/domain/gaming'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 3000
const RETRY_RECHECK_DELAY_MS = 4000
const PHASE_READY_DELAY_MS = 2000

function markersEqual(a: PreGroupMarkers | undefined, b: PreGroupMarkers | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  return a.name === b.name && a.type === b.type
}

function updatePreGroupMarkers(team: SessionSummoner[], markers: Record<string, PreGroupMarkers>) {
  for (const player of team) {
    const marker = markers[player.summoner.puuid]
    if (marker && !markersEqual(player.preGroupMarkers, marker)) {
      player.preGroupMarkers = marker
    }
  }
}

/**
 * 生成玩家状态的轻量签名：同 puuid 下若以下关键字段全部一致，视为"数据未变"可跳过更新。
 * 远快于 JSON.stringify 整个对象（后者会序列化 matchHistory.games.games 等大数组）。
 */
function playerSignature(p: SessionSummoner): string {
  const solo = p.rank?.queueMap?.RANKED_SOLO_5x5
  return [
    p.summoner.puuid,
    p.championId,
    p.isLoading ? 1 : 0,
    p.matchHistory?.games?.games?.length ?? -1,
    p.userTag?.tag?.length ?? -1,
    p.meetGames?.length ?? -1,
    solo?.tier ?? '',
    solo?.leaguePoints ?? -1,
    p.preGroupMarkers?.name ?? ''
  ].join('|')
}

function updatePlayerAtIndex(team: SessionSummoner[], index: number, newPlayer: SessionSummoner) {
  if (!team || index >= team.length) return
  const oldPlayer = team[index]

  // 同一玩家时保留 meetGames/preGroupMarkers（后端最后阶段才计算，避免闪烁）
  if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
    newPlayer.meetGames = oldPlayer.meetGames
    newPlayer.preGroupMarkers = oldPlayer.preGroupMarkers
  }
  team[index] = newPlayer
}

function updateBasicInfo(currentTeam: SessionSummoner[], newTeam: SessionSummoner[]) {
  if (!newTeam || newTeam.length === 0) return

  for (let i = 0; i < newTeam.length; i++) {
    const newPlayer = newTeam[i]
    if (i < currentTeam.length) {
      const oldPlayer = currentTeam[i]
      if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
        oldPlayer.championId = newPlayer.championId
        oldPlayer.championKey = newPlayer.championKey
        oldPlayer.summoner = newPlayer.summoner
      } else {
        currentTeam[i] = newPlayer
      }
    } else {
      currentTeam.push(newPlayer)
    }
  }

  if (currentTeam.length > newTeam.length) {
    currentTeam.splice(newTeam.length)
  }
}

function updateTeamData(currentTeam: SessionSummoner[], newTeam: SessionSummoner[]) {
  if (!newTeam || newTeam.length === 0) {
    if (currentTeam.length > 0) currentTeam.splice(0, currentTeam.length)
    return
  }

  for (let i = 0; i < newTeam.length; i++) {
    const newPlayer = newTeam[i]
    if (i < currentTeam.length) {
      const oldPlayer = currentTeam[i]
      let shouldUpdate = true
      if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
        if (newPlayer.isLoading && !oldPlayer.isLoading) shouldUpdate = false
        else if (playerSignature(newPlayer) === playerSignature(oldPlayer)) shouldUpdate = false
      }
      if (shouldUpdate) currentTeam[i] = newPlayer
    } else {
      currentTeam.push(newPlayer)
    }
  }

  if (currentTeam.length > newTeam.length) {
    currentTeam.splice(newTeam.length)
  }
}

export function useSessionSync() {
  const sessionData = reactive<SessionData>({
    phase: '',
    type: '',
    typeCn: '',
    queueId: 0,
    teamOne: [],
    teamTwo: []
  })

  const unlisteners: Array<() => void> = []

  async function requestSessionData() {
    try {
      await invoke('get_session_data')
    } catch (error) {
      console.error('Failed to request session data:', error)
    }
  }

  let retryCount = 0
  function checkAndRetryFetch() {
    if (sessionData.phase !== 'InProgress' && sessionData.phase !== 'GameStart') return

    const enemyMissing =
      !sessionData.teamTwo ||
      sessionData.teamTwo.length === 0 ||
      sessionData.teamTwo.every(p => !p.summoner.gameName)

    if (enemyMissing && retryCount < MAX_RETRIES) {
      retryCount++
      setTimeout(() => {
        requestSessionData()
        setTimeout(checkAndRetryFetch, RETRY_RECHECK_DELAY_MS)
      }, RETRY_DELAY_MS)
    }
  }

  onMounted(async () => {
    unlisteners.push(
      await listen<SessionData>('session-complete', event => {
        const data = event.payload
        if (!data.phase) return
        sessionData.phase = data.phase
        sessionData.type = data.type
        sessionData.typeCn = data.typeCn
        sessionData.queueId = data.queueId
        updateTeamData(sessionData.teamOne, Array.isArray(data.teamOne) ? data.teamOne : [])
        updateTeamData(sessionData.teamTwo, Array.isArray(data.teamTwo) ? data.teamTwo : [])
      })
    )

    unlisteners.push(
      await listen<SessionData>('session-basic-info', event => {
        const data = event.payload
        if (!data.phase) return
        sessionData.phase = data.phase
        sessionData.type = data.type
        sessionData.typeCn = data.typeCn
        sessionData.queueId = data.queueId
        updateBasicInfo(sessionData.teamOne, Array.isArray(data.teamOne) ? data.teamOne : [])
        updateBasicInfo(sessionData.teamTwo, Array.isArray(data.teamTwo) ? data.teamTwo : [])
      })
    )

    unlisteners.push(
      await listen<Record<string, PreGroupMarkers>>('session-pre-group', event => {
        updatePreGroupMarkers(sessionData.teamOne, event.payload)
        updatePreGroupMarkers(sessionData.teamTwo, event.payload)
      })
    )

    unlisteners.push(
      await listen('session-player-update-team-one', (event: any) => {
        const { index, player } = event.payload
        updatePlayerAtIndex(sessionData.teamOne, index, player)
      })
    )

    unlisteners.push(
      await listen('session-player-update-team-two', (event: any) => {
        const { index, player } = event.payload
        updatePlayerAtIndex(sessionData.teamTwo, index, player)
      })
    )

    unlisteners.push(
      await listen<string>('session-error', event => {
        console.error('Session error:', event.payload)
      })
    )

    await requestSessionData()
  })

  watch(
    () => sessionData.phase,
    (newVal, oldVal) => {
      if (newVal === 'InProgress' && oldVal !== 'InProgress') {
        retryCount = 0
        setTimeout(checkAndRetryFetch, PHASE_READY_DELAY_MS)
      }
    }
  )

  onUnmounted(() => {
    for (const off of unlisteners) off()
  })

  return { sessionData, requestSessionData }
}
