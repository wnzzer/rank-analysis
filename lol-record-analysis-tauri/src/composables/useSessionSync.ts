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

/**
 * CHERRY/斗魂模式专用：EOG 端点（lol-end-of-game/v1/gameclient-eog-stats-block）
 * 在 InProgress 开始几分钟内不可用，期间 Rust 端会回退到 tpid 分组（新斗魂下完全错乱）
 * 并把 cherrySubteamsPending=true 推送给前端。
 * 前端在此期间持续轮询直到拿到权威 subteamId。
 */
const CHERRY_POLL_INTERVAL_MS = 12000
// 上限 50 次 = 10 分钟覆盖。实测有局 EOG 直到 InProgress 第 13 分钟才 ready,
// 给足余量,且 EOG ready 后 polling 自动停止,不会持续空转。
const CHERRY_POLL_MAX_ATTEMPTS = 50

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
export function playerSignature(p: SessionSummoner): string {
  const solo = p.rank?.queueMap?.RANKED_SOLO_5x5
  // recentData（近期数据面板的模式/KDA/胜率等）必须参与签名：
  // 玩家常先以「战绩已到、近期数据未算好」的包到达，若签名不含这些字段，
  // 补算完成的包会被当成「无变化」跳过，面板就永远停在 KDA 0 / 胜率 0%
  const r = p.userTag?.recentData
  return [
    p.summoner.puuid,
    p.championId,
    p.isLoading ? 1 : 0,
    p.matchHistory?.games?.games?.length ?? -1,
    p.userTag?.tag?.length ?? -1,
    p.meetGames?.length ?? -1,
    solo?.tier ?? '',
    solo?.leaguePoints ?? -1,
    p.preGroupMarkers?.name ?? '',
    p.pickState ?? '',
    r?.selectMode ?? -1,
    r?.selectWins ?? -1,
    r?.selectLosses ?? -1,
    r?.kda ?? -1,
    r?.kills ?? -1,
    r?.deaths ?? -1,
    r?.assists ?? -1,
    r?.groupRate ?? -1,
    r?.damageDealtToChampionsRate ?? -1
  ].join('|')
}

function findSubteam(subteams: Subteam[], subteamId: number): Subteam | undefined {
  return subteams.find(s => s.subteamId === subteamId)
}

/**
 * 原位合并玩家数据：保持数组槽位里的对象身份不变。
 * 整体替换对象会让 PlayerCard 的 props 引用变化 → 内部 watcher（OP.GG chip 拉取等）
 * 全部重跑，选人期 pickState 高频变化时表现为卡片抖动/闪烁。
 * @param preserveLocalFields - 保留旧对象的 meetGames/preGroupMarkers
 *（session-player-update 单玩家事件不带这两个字段的有效值，由独立事件维护）
 */
function mergePlayerInPlace(
  oldPlayer: SessionSummoner,
  newPlayer: SessionSummoner,
  preserveLocalFields: boolean
) {
  const { meetGames, preGroupMarkers } = oldPlayer
  Object.assign(oldPlayer, newPlayer)
  if (preserveLocalFields) {
    oldPlayer.meetGames = meetGames
    oldPlayer.preGroupMarkers = preGroupMarkers
  }
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
    // 防闪烁守卫：加载占位不回退已加载内容、签名一致视为无变化直接跳过
    if (newPlayer.isLoading && !oldPlayer.isLoading) return
    if (playerSignature(newPlayer) === playerSignature(oldPlayer)) return
    mergePlayerInPlace(oldPlayer, newPlayer, true)
    return
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

export function syncPlayers(
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
          oldPlayer.pickState = newPlayer.pickState
        } else {
          currentTeam[i] = newPlayer
        }
      } else {
        if (oldPlayer && oldPlayer.summoner.puuid === newPlayer.summoner.puuid) {
          // 同一玩家：加载占位不回退、签名一致跳过，有变化则原位合并（保持对象身份，
          // full 事件带权威的 meetGames/preGroupMarkers，不保留旧值）
          if (newPlayer.isLoading && !oldPlayer.isLoading) continue
          if (playerSignature(newPlayer) === playerSignature(oldPlayer)) continue
          mergePlayerInPlace(oldPlayer, newPlayer, false)
        } else if (oldPlayer && !oldPlayer.isLoading && newPlayer.isLoading) {
          // 同一格位从「已加载的玩家」被刷成「无身份的加载占位」（puuid 对不上）：
          // 保留旧内容等真实数据到达，避免 内容→转圈→内容 的闪烁
        } else {
          currentTeam[i] = newPlayer
        }
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
    subteams: [],
    cherrySubteamsPending: false
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

  /**
   * 新开一局：清空上一局残留的对局面板（尤其是敌方小队）并重新拉取。
   *
   * 结算后停留在对局页时，面板刻意保留上一局数据供复盘（空 phase 事件被忽略）。
   * 但进入下一局选人时必须清场——否则在新数据到达前，右侧仍显示上一局的敌方。
   * phase 置空让页面回到「等待加入游戏...」态，随后选人数据会立刻填充我方。
   */
  function resetForNewGame() {
    sessionData.phase = ''
    sessionData.type = ''
    sessionData.typeCn = ''
    sessionData.queueId = 0
    sessionData.gameMode = ''
    sessionData.isMultiTeam = false
    sessionData.mySubteamId = 0
    sessionData.cherrySubteamsPending = false
    sessionData.champSelect = undefined
    sessionData.subteams.splice(0, sessionData.subteams.length)
    requestSessionData()
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
    sessionData.cherrySubteamsPending = !!data.cherrySubteamsPending
    // 后端仅在 ChampSelect 期间下发该字段（skip_serializing_if）；离开选人后
    // 事件里 data.champSelect 缺席 → undefined 直接覆盖旧值，面板自动清空阶段/ban 展示。
    sessionData.champSelect = data.champSelect
  }

  /**
   * CHERRY/斗魂模式专用轮询：直到 EOG 端点 ready（cherrySubteamsPending 转 false）才停。
   *
   * 触发条件：CHERRY + 处于 InProgress / GameStart / PreEndOfGame / EndOfGame 之一 + 当前 pending=true
   * 间隔：CHERRY_POLL_INTERVAL_MS
   * 上限：CHERRY_POLL_MAX_ATTEMPTS 次（一般几次内就能拿到权威分队）
   */
  let cherryPollAttempts = 0
  function pollCherrySubteams() {
    if (!sessionData.cherrySubteamsPending) return
    const inGame = ['InProgress', 'GameStart', 'PreEndOfGame', 'EndOfGame'].includes(
      sessionData.phase
    )
    if (!inGame || sessionData.gameMode !== 'CHERRY') return
    if (cherryPollAttempts >= CHERRY_POLL_MAX_ATTEMPTS) return
    cherryPollAttempts++
    requestSessionData()
    trackedSetTimeout(pollCherrySubteams, CHERRY_POLL_INTERVAL_MS)
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

    // 监听 game_state_monitor 的可靠 phase 流（每 2s 轮询 + 变化即推）：
    // 检测到进入选人（= 新开一局）且面板还挂着上一局数据时，立即清场重拉。
    // 以 sessionData.phase !== 'ChampSelect' 防抖——若选人数据已先行到达则无需清。
    let lastMonitorPhase = ''
    unlisteners.push(
      await listen<{ phase: string | null }>('game-state-changed', event => {
        const phase = event.payload.phase ?? ''
        if (
          phase === 'ChampSelect' &&
          lastMonitorPhase !== 'ChampSelect' &&
          sessionData.phase !== 'ChampSelect'
        ) {
          resetForNewGame()
        }
        lastMonitorPhase = phase
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

  // CHERRY 模式 pending 时启动持续轮询；pending 一旦转 false（EOG ready）就自然停止
  watch(
    () => sessionData.cherrySubteamsPending,
    pending => {
      if (pending && sessionData.gameMode === 'CHERRY') {
        cherryPollAttempts = 0
        trackedSetTimeout(pollCherrySubteams, CHERRY_POLL_INTERVAL_MS)
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
