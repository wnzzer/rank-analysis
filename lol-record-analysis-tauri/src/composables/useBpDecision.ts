/**
 * 选人期 BP 决策快照的轮询与倒计时插值。
 *
 * 与 {@link useSessionSync} **平行而非嵌套**：决策快照是会话级单例、一次算完、
 * 纯展示，不需要 per-player 的引用稳定性，因此完全不走 syncPlayers 那条链。
 *
 * 倒计时必须本地插值——后端 2 秒一个 tick，直接绑定 `time_left_secs` 会 2 秒一跳。
 *
 * @module composables/useBpDecision
 */
import {
  computed,
  onUnmounted,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { BpDecision } from '@renderer/types/bpDecision'

/** 轮询间隔。比后端 2s 的产出快一档，让决策带对局面变化的反应更跟手 */
const POLL_MS = 1000
/** 倒计时插值帧间隔 */
const TICK_MS = 100

export function useBpDecision(phase: MaybeRefOrGetter<string>): {
  /** 当前决策快照，非选人期或无待办动作时为 null */
  decision: Ref<BpDecision | null>
  /** 本地插值后的剩余秒数，恒 >= 0 */
  displaySecs: ComputedRef<number>
} {
  const decision = ref<BpDecision | null>(null)
  /** 最近一次快照到达时的基准秒数与本地时刻 */
  const baseSecs = ref(0)
  const baseAt = ref(0)
  /** 插值时钟，仅用于驱动 displaySecs 重算 */
  const now = ref(0)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null

  const displaySecs = computed(() => {
    if (!decision.value) return 0
    const elapsed = Math.max(0, (now.value - baseAt.value) / 1000)
    return Math.max(0, baseSecs.value - elapsed)
  })

  async function poll(): Promise<void> {
    try {
      const next = await invoke<BpDecision | null>('get_bp_decision')
      decision.value = next
      if (next) {
        baseSecs.value = next.time_left_secs
        baseAt.value = Date.now()
      }
    } catch {
      // 数据缺失是常态降级：命令未就绪 / 客户端未连接，静默保持上一帧
    }
  }

  function stop(): void {
    if (pollTimer) clearInterval(pollTimer)
    if (tickTimer) clearInterval(tickTimer)
    pollTimer = null
    tickTimer = null
    decision.value = null
    baseSecs.value = 0
    baseAt.value = 0
  }

  function start(): void {
    if (pollTimer) return
    void poll()
    pollTimer = setInterval(() => void poll(), POLL_MS)
    tickTimer = setInterval(() => {
      now.value = Date.now()
    }, TICK_MS)
  }

  watch(
    () => toValue(phase),
    p => (p === 'ChampSelect' ? start() : stop()),
    { immediate: true }
  )

  onUnmounted(stop)

  return { decision, displaySecs }
}
