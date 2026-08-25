/**
 * 对局中实时分析（D-P2 对局中 tab）——基于 useGamingAIAnalysis 的流式基础设施独立成块。
 *
 * 与选人期/整队分析不同，这里多一层「实时快照轮询」：
 * - 对局中（phase === 'InProgress'）每隔 {@link pollIntervalMs} 轮询一次
 *   liveclientdata（本地纯 HTTP，无鉴权），快照进了 AI 之前先经 liveGameIntel
 *   确定性聚合，prompt 只引用不算；
 * - 不在对局中时停轮询、清快照，但结果保留（切 tab 不丢进度）；
 * - 自动发起带 3 分钟限流（与 useGamingAIAnalysis 同规），显式 rerun 不受限。
 *
 * 快照查询失败/暂无对局是常态（远端返回 null），不弹错；只有 AI 流式失败才报。
 *
 * @module composables/useLiveAIAnalysis
 */
import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'
import { useMessage } from 'naive-ui'
import { analyzeLiveGameWithAIStream, type StreamCallbacks } from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { getLiveGameData, type LiveGameSnapshot } from '@renderer/features/gaming/services/liveGame'
import { recommendedItemsOf } from '@renderer/features/gaming/services/liveGameIntel'
import { getBuildStats } from '@renderer/services/builds'
import type { SessionData } from '@renderer/types/domain/gaming'

/** 自动发起限流窗口（同一局内连续自动触发的最小间隔） */
const AUTO_RUN_THROTTLE_MS = 3 * 60 * 1000

/** 实时快照轮询间隔（liveclientdata 是本地端点，负担极小） */
const POLL_INTERVAL_MS = 15 * 1000

/**
 * 我方召唤师的最小结构。只需 gameName（liveclientdata 里定位自己）与
 * puuid（sessionData 里反查 championId）——兼容 LCU 原始对象与领域模型。
 */
export interface LiveMeInfo {
  gameName?: string
  puuid?: string
}

export interface LiveAIAnalysisOptions {
  /** 我方召唤师，可传 ref/getter 实时读取 */
  mySummoner?: MaybeRefOrGetter<LiveMeInfo | null>
  /** 快照轮询间隔，默认 15s */
  pollIntervalMs?: number
  /** 自动发起限流窗口，默认 3min */
  autoRunThrottleMs?: number
}

export function useLiveAIAnalysis(
  sessionData: SessionData,
  options: LiveAIAnalysisOptions = {}
): {
  /** 对局中分析是否正在进行 */
  loading: Ref<boolean>
  /** 已流入的 markdown 原文（对局中 tab 展示） */
  result: Ref<string>
  renderedResult: ComputedRef<string>
  /** 最近一次轮询到的实时快照（非对局中会清空） */
  snapshot: Ref<LiveGameSnapshot | null>
  /** 最近一次轮询成功时刻（毫秒；未轮询到过为 null） */
  lastPollAt: Ref<number | null>
  /** 当前是否在对局中（决定轮询开关） */
  inGame: ComputedRef<boolean>
  /** 打开面板/切到对局中 tab 时调用：面板没东西可看且限流通过才自动发起 */
  ensureStarted: () => void
  /** 「重新分析」：无条件基于最新快照重跑（不受限流约束） */
  rerun: () => Promise<void>
} {
  const message = useMessage()
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const autoRunThrottleMs = options.autoRunThrottleMs ?? AUTO_RUN_THROTTLE_MS

  const loading = ref(false)
  const result = ref('')
  const renderedResult = computed(() => renderAnalysisReport(result.value))
  const snapshot = ref<LiveGameSnapshot | null>(null)
  const lastPollAt = ref<number | null>(null)
  const inGame = computed(() => sessionData.phase === 'InProgress')

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let lastAutoRunAt = 0

  async function pollOnce(): Promise<void> {
    const data = await getLiveGameData()
    if (!inGame.value) return
    snapshot.value = data
    if (data) lastPollAt.value = Date.now()
  }

  function startPolling(): void {
    if (pollTimer) return
    void pollOnce()
    pollTimer = setInterval(() => void pollOnce(), pollIntervalMs)
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    snapshot.value = null
    lastPollAt.value = null
  }

  // 进入对局开始轮询；离开对局停轮询并复位限流（新一局该重新计数）
  watch(
    () => sessionData.phase,
    phase => {
      if (phase === 'InProgress') {
        lastAutoRunAt = 0
        startPolling()
      } else {
        stopPolling()
      }
    },
    { immediate: true }
  )

  onScopeDispose(() => stopPolling())

  async function run(): Promise<void> {
    const latest = snapshot.value
    if (!latest) {
      message.warning('暂无对局实时数据，稍后再试')
      return
    }
    loading.value = true
    result.value = ''

    try {
      // 我方定位：sessionData 里按 puuid 找自己的 championId（liveclientdata 只有显示名，不可当 id）
      const summoner = toValue(options.mySummoner)
      let championId: number | null = null
      for (const sub of sessionData.subteams) {
        const p = sub.players.find(s => s.summoner.puuid === summoner?.puuid)
        if (p) {
          championId = p.championId
          break
        }
      }
      const stats =
        summoner?.puuid && championId != null
          ? await getBuildStats(summoner.puuid, championId, sessionData.queueId)
          : null
      const recommended = recommendedItemsOf(stats)

      const callbacks: StreamCallbacks = {
        onChunk: chunk => {
          result.value += chunk
        },
        onDone: () => {
          loading.value = false
        },
        onError: error => {
          message.error('对局中分析出错: ' + error)
          loading.value = false
        }
      }
      await analyzeLiveGameWithAIStream(latest, callbacks, {
        myGameName: summoner?.gameName ?? '',
        recommendedItems: recommended ?? undefined
      })
    } catch (e) {
      message.error('对局中分析出错: ' + ((e instanceof Error && e.message) || '未知错误'))
      loading.value = false
    }
  }

  function ensureStarted(): void {
    if (loading.value || result.value) return
    const now = Date.now()
    if (now - lastAutoRunAt < autoRunThrottleMs) return
    lastAutoRunAt = now
    void run()
  }

  async function rerun(): Promise<void> {
    if (loading.value) return
    lastAutoRunAt = Date.now()
    // rerun 语义 = 用户要基于最新数据重看 → 先补一轮快照
    await pollOnce()
    await run()
  }

  return {
    loading,
    result,
    renderedResult,
    snapshot,
    lastPollAt,
    inGame,
    ensureStarted,
    rerun
  }
}
