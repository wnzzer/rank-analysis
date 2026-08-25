import { ref, readonly, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import router from '../router'
import { isRecordChildWindow } from '@renderer/utils/windows'

export interface GameStateEvent {
  connected: boolean
  phase: string | null
  /** 未连接时的失败归类码：'NOT_RUNNING' | 'ACCESS_DENIED' | 'OTHER'，已连接为 null */
  reasonCode: string | null
  /** 未连接时面向用户的失败说明 */
  reasonMessage: string | null
  /**
   * 后端 `Summoner`（lcu/api/summoner.rs）的序列化形状，恰好 5 个字段。
   * 此前声明了 LCU 原始接口的十余个字段——经 GameStateEvent 序列化时它们
   * 恒为 undefined（类型失真），已对齐后端真实形状。
   */
  summoner: {
    gameName: string
    tagLine: string
    summonerLevel: number
    profileIconId: number
    puuid: string
  } | null
}

interface SessionData {
  phase: string
}

// ─── module-level singleton state ─────────────────────────────────────────────
// Framework.vue + SideNavigation.vue 都消费 useGameState；若每个组件 mount 时各注册
// 一份 listener，event 会被分发到所有 handler（路由跳转、console.log、状态更新都跑
// 多份）。这里改为 singleton：共享 refs + 单一 listener，配合 refcount 在最后一个
// 消费者 unmount 时清理。

const isConnected = ref(false)

/**
 * LCU 连接状态的模块级只读引用。
 *
 * 供非组件上下文（如 cloudSync store）watch「连接建立」时机——值由本 composable
 * 的单例监听器维护（主窗口 Framework 常驻挂载，监听始终在线），无需自建轮询。
 */
export const lcuConnected = readonly(isConnected)

const currentPhase = ref<string | null>(null)
const summoner = ref<GameStateEvent['summoner'] | null>(null)
const reasonCode = ref<string | null>(null)
const reasonMessage = ref<string | null>(null)

let unlistenState: UnlistenFn | null = null
let unlistenSession: UnlistenFn | null = null
let listenerSetupPromise: Promise<void> | null = null
let activeInstances = 0
let lastPhase = ''

/** 处理连接状态的路由切换。 */
function handleConnectionRoute(state: GameStateEvent) {
  // 战绩子窗口（record-*）：不自动跳转，保持打开的是哪页就是哪页
  if (isRecordChildWindow()) {
    return
  }
  const currentPath = router.currentRoute.value.path

  if (state.connected && state.summoner) {
    // 历史深链兼容：连接建立时仍停留在旧 /Loading 门则送进战绩页；
    // 其余页面不强制跳转，主页状态卡会自行亮起在线态
    if (currentPath === '/Loading') {
      router.push({
        path: '/Record',
        query: {
          name: `${state.summoner.gameName}#${state.summoner.tagLine}`
        }
      })
    }
    return
  }

  // 断连：落地主页（状态卡承接原 Loading 职责）。
  // 设置页豁免：设置不依赖 LCU 连接，且状态事件每 ≤10s 心跳一次，
  // 不豁免会把正在改设置的用户反复踢走
  if (
    currentPath !== '/Home' &&
    !currentPath.startsWith('/Settings') &&
    !currentPath.startsWith('/Loading')
  ) {
    router.push({ path: '/Home' })
  }
}

async function setupListeners() {
  // 1. 监听游戏状态 (连接/断开)
  unlistenState = await listen<GameStateEvent>('game-state-changed', event => {
    const state = event.payload
    console.log('🎮 Game state changed:', state)

    isConnected.value = state.connected
    currentPhase.value = state.phase
    summoner.value = state.summoner
    reasonCode.value = state.reasonCode ?? null
    reasonMessage.value = state.reasonMessage ?? null

    handleConnectionRoute(state)
  })

  // 2. 监听会话状态 (选人/游戏中)
  unlistenSession = await listen<SessionData>('session-complete', event => {
    const phase = event.payload.phase

    if (phase !== lastPhase) {
      if (
        (phase === 'ChampSelect' || phase === 'InProgress' || phase === 'GameStart') &&
        router.currentRoute.value.name !== 'Gaming' &&
        !isRecordChildWindow()
      ) {
        console.log(`🎮 [Auto-Nav] Phase changed to ${phase}, navigating to Gaming...`)
        router.push('/Gaming')
      }
      lastPhase = phase
    }
  })

  console.log('Game state listeners registered')
}

function teardownListeners() {
  if (unlistenState) {
    unlistenState()
    unlistenState = null
  }
  if (unlistenSession) {
    unlistenSession()
    unlistenSession = null
  }
  listenerSetupPromise = null
  console.log('🧹 Game state listeners cleaned up')
}

/**
 * 游戏状态监听 Composable
 *
 * 监听后端发送的游戏状态事件，自动切换路由。多组件调用共享同一份 state +
 * 同一份后台 listener（singleton + refcount），不会因为 Framework / SideNavigation
 * 都调用而导致 event 被双倍触发。
 */
export function useGameState() {
  onMounted(() => {
    activeInstances += 1
    if (listenerSetupPromise === null) {
      listenerSetupPromise = setupListeners()
    }
  })

  onUnmounted(() => {
    activeInstances -= 1
    if (activeInstances <= 0) {
      activeInstances = 0
      teardownListeners()
    }
  })

  return {
    isConnected,
    currentPhase,
    summoner,
    reasonCode,
    reasonMessage
  }
}
