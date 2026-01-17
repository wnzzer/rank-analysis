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

/**
 * 游戏状态监听 Composable
 * 监听后端发送的游戏状态事件，自动切换路由
 */
export function useGameState() {
  const isConnected = ref(false)
  const currentPhase = ref<string | null>(null)
  const summoner = ref<GameStateEvent['summoner'] | null>(null)

  let unlisten: UnlistenFn | null = null

  onMounted(async () => {
    // 监听后端发送的游戏状态变化事件
    unlisten = await listen<GameStateEvent>('game-state-changed', event => {
      const state = event.payload

      console.log('🎮 Game state changed:', state)

      isConnected.value = state.connected
      currentPhase.value = state.phase
      summoner.value = state.summoner

      // 自动切换路由
      handleRouteChange(state)
    })

    console.log('✅ Game state listener registered')
  })

  onUnmounted(() => {
    // 组件卸载时清理监听器
    if (unlisten) {
      unlisten()
      console.log('🧹 Game state listener cleaned up')
    }
  })

  /**
   * 根据游戏状态自动切换路由
   */
  function handleRouteChange(state: GameStateEvent) {
    const currentPath = router.currentRoute.value.path

    if (state.connected && state.summoner) {
      // 游戏客户端已连接
      if (currentPath === '/Loading') {
        // 从 Loading 页面跳转到 Record 页面
        router.push({
          path: '/Record',
          query: {
            name: `${state.summoner.gameName}#${state.summoner.tagLine}`
          }
        })
        console.log('📍 Auto navigated to Record page')
      }
    } else {
      // 游戏客户端断开连接
      if (currentPath !== '/Loading') {
        // 跳转到 Loading 页面
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
