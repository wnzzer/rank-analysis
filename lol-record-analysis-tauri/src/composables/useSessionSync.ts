/**
 * 对局会话数据同步：订阅 LCU 推送事件 + 增量合并玩家数据
 * 多小队模型（CLASSIC: 2 个 subteam，CHERRY: 1~8 个 subteam）
 */

import { onMounted, onUnmounted, reactive, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type {
  PreGroupMarkers,
  SessionData,
  SessionSummoner,
  Subteam
} from '@renderer/types/domain/gaming'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 3000
const RETRY_RECHECK_DELAY_MS = 4000
const PHASE_READY_DELAY_MS = 2000

function markersEqual(a: PreGroupMarkers | undefined, b: PreGroupMarkers | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  return a.name === b.name && a.type === b.type
}

function updatePreGroupMarkers(subteams: Subteam[], markers: Record<string, PreGroupMarkers>) {
  for (const st of subteams) {
    for (const player of st.players) {
      const marker = markers[player.summoner.puuid]
      if (marker && !markersEqual(player.preGroupMarkers, marker)) {
        player.preGroupMarkers = marker
      }
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

function findSubteam(subteams: Subteam[], subteamId: number): Subteam | undefined {
  return subteams.find(s => s.subteamId === subteamId)
}

function updatePlayerInSubteam(
  subteams: Subteam[],
  subteamId: number,
  index: number,
  newPlayer: SessionSummoner
) {
  const st = findSubteam(subteams, subteamId)
  if (!st || index >= st.players.length) return
  const oldPlayer = st.players[index]
  if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
    newPlayer.meetGames = oldPlayer.meetGames
    newPlayer.preGroupMarkers = oldPlayer.preGroupMarkers
  }
  st.players[index] = newPlayer
}

function syncSubteams(current: Subteam[], next: Subteam[], mode: 'basic' | 'full') {
  const nextIds = new Set(next.map(s => s.subteamId))

  for (let i = current.length - 1; i >= 0; i--) {
    if (!nextIds.has(current[i].subteamId)) current.splice(i, 1)
  }

  for (const nst of next) {
    let cst = current.find(s => s.subteamId === nst.subteamId)
    if (!cst) {
      cst = { subteamId: nst.subteamId, players: [] }
      current.push(cst)
    }
    syncPlayers(cst.players, nst.players, mode)
  }
  current.sort((a, b) => a.subteamId - b.subteamId)
}

function syncPlayers(
  currentTeam: SessionSummoner[],
  newTeam: SessionSummoner[],
  mode: 'basic' | 'full'
) {
  if (!newTeam || newTeam.length === 0) {
    if (currentTeam.length > 0) currentTeam.splice(0, currentTeam.length)
    return
  }
  for (let i = 0; i < newTeam.length; i++) {
    const newPlayer = newTeam[i]
    if (i < currentTeam.length) {
      const oldPlayer = currentTeam[i]
      if (mode === 'basic') {
        if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
          oldPlayer.championId = newPlayer.championId
          oldPlayer.championKey = newPlayer.championKey
          oldPlayer.summoner = newPlayer.summoner
        } else {
          currentTeam[i] = newPlayer
        }
      } else {
        let shouldUpdate = true
        if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
          if (newPlayer.isLoading && !oldPlayer.isLoading) shouldUpdate = false
          else if (playerSignature(newPlayer) === playerSignature(oldPlayer)) shouldUpdate = false
        }
        if (shouldUpdate) currentTeam[i] = newPlayer
      }
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
    gameMode: '',
    isMultiTeam: false,
    mySubteamId: 0,
    subteams: []
  })

  const unlisteners: Array<() => void> = []
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

  /**
   * 包装 setTimeout，把 id 记入 pendingTimers，回调执行时自动移除。
   * onUnmounted 会清掉仍未触发的 timer，避免组件卸载后写响应式状态。
   */
  function trackedSetTimeout(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      pendingTimers.delete(id)
      fn()
    }, ms)
    pendingTimers.add(id)
    return id
  }

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

    const enoughSubteams = sessionData.isMultiTeam
      ? sessionData.subteams.length >= 2
      : sessionData.subteams.some(
          s => s.subteamId !== sessionData.mySubteamId && s.players.some(p => p.summoner.gameName)
        )

    if (!enoughSubteams && retryCount < MAX_RETRIES) {
      retryCount++
      trackedSetTimeout(() => {
        requestSessionData()
        trackedSetTimeout(checkAndRetryFetch, RETRY_RECHECK_DELAY_MS)
      }, RETRY_DELAY_MS)
    }
  }

  function applyMeta(data: SessionData) {
    sessionData.phase = data.phase
    sessionData.type = data.type
    sessionData.typeCn = data.typeCn
    sessionData.queueId = data.queueId
    sessionData.gameMode = data.gameMode ?? ''
    sessionData.isMultiTeam = !!data.isMultiTeam
    sessionData.mySubteamId = data.mySubteamId ?? 0
  }

  onMounted(async () => {
    unlisteners.push(
      await listen<SessionData>('session-complete', event => {
        const data = event.payload
        if (!data.phase) return
        applyMeta(data)
        syncSubteams(
          sessionData.subteams,
          Array.isArray(data.subteams) ? data.subteams : [],
          'full'
        )
      })
    )

    unlisteners.push(
      await listen<SessionData>('session-basic-info', event => {
        const data = event.payload
        if (!data.phase) return
        applyMeta(data)
        syncSubteams(
          sessionData.subteams,
          Array.isArray(data.subteams) ? data.subteams : [],
          'basic'
        )
      })
    )

    unlisteners.push(
      await listen<Record<string, PreGroupMarkers>>('session-pre-group', event => {
        updatePreGroupMarkers(sessionData.subteams, event.payload)
      })
    )

    unlisteners.push(
      await listen<{ subteamId: number; index: number; total: number; player: SessionSummoner }>(
        'session-player-update',
        event => {
          const { subteamId, index, player } = event.payload
          updatePlayerInSubteam(sessionData.subteams, subteamId, index, player)
        }
      )
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
        trackedSetTimeout(checkAndRetryFetch, PHASE_READY_DELAY_MS)
      }
    }
  )

  onUnmounted(() => {
    for (const off of unlisteners) off()
    for (const id of pendingTimers) clearTimeout(id)
    pendingTimers.clear()
  })

  return { sessionData, requestSessionData }
}
