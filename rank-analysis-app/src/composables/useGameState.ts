import { ref, readonly, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import router from '../router'

export interface GameStateEvent {
  connected: boolean
  phase: string | null
  /** 未连接时的失败归类码：'NOT_RUNNING' | 'ACCESS_DENIED' | 'OTHER'，已连接为 null */
  reasonCode: string | null
  /** 未连接时面向用户的失败说明 */
  reasonMessage: string | null
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

function isStandaloneDetailRoute() {
  return getCurrentWindow().label.startsWith('match-detail-')
}

/**
 * 处理连接状态的路由切换。
 *
 * 断开时把用户推回 Loading，但 `meta.offlineCapable` 的页面豁免——因为
 * `game-state-changed` 是 ≤10s 一次的心跳（见 game_state_monitor.rs 的
 * `state_changed || diff_time > 10s`），**状态没变也会推**，不豁免的页面在未开
 * 客户端时最多待 10 秒就被弹走，等于完全不可用。
 *
 * 豁免名单放在路由 meta 而不是这里硬编码路径前缀：后者已经漏过一次——`/Champions`
 * （#168 新增，数据走 OP.GG 与 LCU 无关）没进名单，未开客户端时进去必被踢回。
 */
/**
 * 连接断开时，当前路由是否该被推回 Loading。
 *
 * 提成纯函数只为可测：这条判定是「未开客户端能不能用某个页面」的唯一开关，
 * 之前没有任何测试守护，`/Champions` 因此漏了整整一个版本。
 *
 * @param route - 当前路由的路径与 meta（只取判定需要的两个字段）
 * @returns true 表示该把用户推回 Loading
 */
export function shouldRedirectToLoading(route: {
  path: string
  meta: { offlineCapable?: boolean }
}): boolean {
  // 已经在 Loading 就别再推一次，否则心跳会不断产生重复导航
  if (route.path === '/Loading') {
    return false
  }
  return route.meta.offlineCapable !== true
}

function handleConnectionRoute(state: GameStateEvent) {
  const currentRoute = router.currentRoute.value
  const currentPath = currentRoute.path

  // 独立详情窗有自己的生命周期，不参与主窗口的连接态导航（窗口 label 判断，
  // 无法用路由 meta 表达，故单独前置）
  if (isStandaloneDetailRoute()) {
    return
  }

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
    // 游戏客户端断开连接，跳转 Loading（离线可用页豁免）
    if (shouldRedirectToLoading(currentRoute)) {
      router.push({
        path: '/Loading'
      })
      console.log('📍 Auto navigated to Loading page')
    }
  }
}

async function setupListeners() {
  if (isStandaloneDetailRoute()) {
    return
  }

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
        router.currentRoute.value.name !== 'Gaming'
      ) {
        console.log(`🎮 [Auto-Nav] Phase changed to ${phase}, navigating to Gaming...`)
        router.push('/Gaming')
      }
      lastPhase = phase
    }
  })

  console.log('✅ Game state listeners registered')
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
