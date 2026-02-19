import { ref, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import router from '../router'

export interface GameStateEvent {
  connected: boolean
  phase: string | null
  summoner: {
    gameName: string
    tagLine: string
    platformIdCn: string
    puuid: string
    summonerId: number
    accountId: number
    displayName: string
    internalName: string
    nameChangeFlag: boolean
    percentCompleteForNextLevel: number
    privacy: string
    profileIconId: number
    rerollPoints: {
      currentPoints: number
      maxRolls: number
      numberOfRolls: number
      pointsCostToRoll: number
      pointsToReroll: number
    }
    summonerLevel: number
    unnamed: boolean
    xpSinceLastLevel: number
    xpUntilNextLevel: number
  } | null
}

interface SessionData {
  phase: string
}

/**
 * 游戏状态监听 Composable
 * 监听后端发送的游戏状态事件，自动切换路由
 */
export function useGameState() {
  const isConnected = ref(false)
  const currentPhase = ref<string | null>(null)
  const summoner = ref<GameStateEvent['summoner'] | null>(null)

  let unlistenState: UnlistenFn | null = null
  let unlistenSession: UnlistenFn | null = null
  let lastPhase = ''

  onMounted(async () => {
    // 1. 监听游戏状态 (连接/断开)
    unlistenState = await listen<GameStateEvent>('game-state-changed', event => {
      const state = event.payload
      console.log('🎮 Game state changed:', state)

      isConnected.value = state.connected
      currentPhase.value = state.phase
      summoner.value = state.summoner

      // 处理基础路由切换 (Loading <-> Record)
      handleConnectionRoute(state)
    })

    // 2. 监听会话状态 (选人/游戏中)
    unlistenSession = await listen<SessionData>('session-complete', event => {
      const data = event.payload
      const phase = data.phase

      if (phase !== lastPhase) {
        if (
          (phase === 'ChampSelect' || phase === 'InProgress' || phase === 'GameStart') &&
          router.currentRoute.value.name !== 'Gaming'
        ) {
          console.log(`🎮 [Auto-Nav] Phase changed to ${phase}, navigating to Gaming...`)
          router.push('/Gaming')
        }
        lastPhase = phase
      }
    })

    console.log('✅ Game state listeners registered')
  })

  onUnmounted(() => {
    if (unlistenState) unlistenState()
    if (unlistenSession) unlistenSession()
    console.log('🧹 Game state listeners cleaned up')
  })

  /**
   * 处理连接状态的路由切换
   */
  function handleConnectionRoute(state: GameStateEvent) {
    const currentPath = router.currentRoute.value.path

    if (state.connected && state.summoner) {
      // 游戏客户端已连接，且当前在 Loading 页，则跳转首页 (Record)
      if (currentPath === '/Loading') {
        router.push({
          path: '/Record',
          query: {
            name: `${state.summoner.gameName}#${state.summoner.tagLine}`
          }
        })
        console.log('📍 Auto navigated to Record page')
      }
    } else {
      // 游戏客户端断开连接，跳转 Loading
      if (currentPath !== '/Loading') {
        router.push({
          path: '/Loading'
        })
        console.log('📍 Auto navigated to Loading page')
      }
    }
  }

  return {
    isConnected,
    currentPhase,
    summoner
  }
}
