/**
 * 选人期 BP 操作台：快照轮询、倒计时插值与手动操作。
 *
 * 与 {@link useBpDecision} 平行：操作台快照同样是会话级单例，后端每 2 秒产出一次。
 * 手动操作（预选 / 确认）先在本地立即生效再发请求——等后端下一个快照回来要 2~3 秒，
 * 点了没反应会让人以为没点上。
 *
 * 在面板上预选**不算接管**：那只是换人选，自动化开着的话到点执行的就是刚点的英雄。
 * 接管只发生在用户去客户端里自己换英雄时（后端判定）。
 *
 * @module composables/useBpPanel
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
import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import { countdownOf, toPanelView, type BpPanelView } from '@renderer/services/bpPanelView'
import type { BpChampionOption, BpPanelSnapshot } from '@renderer/types/bpPanel'
import { deepEqual } from '@renderer/utils/deepEqual'

/** 轮询间隔。比后端 2s 的产出快一档 */
const POLL_MS = 1000
/** 倒计时插值帧间隔 */
const TICK_MS = 100

/**
 * useBpPanel 的可选项
 * @property icon - 英雄 ID → 头像 URL
 * @property onError - 手动操作失败时的提示回调
 */
export interface UseBpPanelOptions {
  icon: (championId: number) => string
  onError?: (text: string) => void
}

/**
 * useBpPanel 的返回值
 * @property view - 面板展示属性；非选人期或没有我的 BP 动作时为 null
 * @property secsLeft - 本地插值后的剩余秒数
 * @property totalSecs - 本回合总秒数（倒计时环的分母）
 * @property championOptions - 搜索框可选英雄
 * @property hover - 把一个英雄定为人选并在客户端里预选（不算接管）
 * @property confirm - 确认当前预选
 */
export interface UseBpPanelReturn {
  view: ComputedRef<BpPanelView | null>
  secsLeft: ComputedRef<number>
  totalSecs: ComputedRef<number>
  championOptions: Ref<BpChampionOption[]>
  hover: (championId: number) => Promise<void>
  confirm: () => Promise<void>
}

/**
 * 选人期 BP 操作台的数据与操作
 * @param phase - 当前游戏阶段；只在 `ChampSelect` 期间轮询
 * @param options - 头像取法与错误提示回调
 * @returns 面板展示属性、倒计时与两个手动操作
 * @example
 * ```ts
 * const panel = useBpPanel(() => sessionData.phase, { icon: getChampionUrl })
 * ```
 */
export function useBpPanel(
  phase: MaybeRefOrGetter<string>,
  options: UseBpPanelOptions
): UseBpPanelReturn {
  const snapshot = ref<BpPanelSnapshot | null>(null)
  const championOptions = ref<BpChampionOption[]>([])
  /** 用户在面板上刚点的英雄；回合切换时清空 */
  const localHoverId = ref<number | null>(null)
  /** 用户刚按了确认；回合切换时清空 */
  const localConfirmed = ref(false)
  /** 英雄名缓存是否已加载（加载完成后触发 view 重算） */
  const namesReady = ref(false)
  /** 最近一次新快照到达的本地时刻 */
  const baseAt = ref(0)
  const now = ref(0)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  /** 轮询代际：stop() 递增使在途请求的迟到结果作废 */
  let pollGeneration = 0

  const view = computed<BpPanelView | null>(() => {
    // 读一下 namesReady：名字缓存加载完成后要重新生成文案
    void namesReady.value
    if (!snapshot.value) return null
    return toPanelView(
      snapshot.value,
      { name: getChampionName, icon: options.icon },
      { hoverId: localHoverId.value, confirmed: localConfirmed.value }
    )
  })

  const countdown = computed(() => {
    const v = view.value
    if (!snapshot.value || !v) return { secsLeft: 0, totalSecs: 0 }
    return countdownOf(snapshot.value, v.autoTargetId !== null && !v.overridden)
  })

  const secsLeft = computed(() => {
    const elapsed = Math.max(0, (now.value - baseAt.value) / 1000)
    return Math.max(0, countdown.value.secsLeft - elapsed)
  })
  const totalSecs = computed(() => countdown.value.totalSecs)

  /**
   * 「同一个动作」的标识：变了就该丢掉本地状态。
   *
   * 只看动作类型与是否已完成，不看等待 / 轮到我——等待阶段预选的英雄，
   * 轮到我时应当还是它，不能因为阶段切换闪回后端两秒前的值。
   */
  const turnKey = computed(() =>
    snapshot.value
      ? `${snapshot.value.action_type}:${snapshot.value.stage === 'Done' ? 'done' : 'open'}`
      : ''
  )
  watch(turnKey, () => {
    localHoverId.value = null
    localConfirmed.value = false
  })

  // 客户端里的预选变了：要么是后端追上了我刚点的，要么是用户去客户端里换了英雄。
  // 两种情况都该以客户端为准，丢掉本地记的那个。（ban 的预选可能一直是 0，本地值保留。）
  watch(
    () => snapshot.value?.hovered_id,
    id => {
      if (id) localHoverId.value = null
    }
  )

  async function poll(): Promise<void> {
    const gen = pollGeneration
    try {
      const next = await invoke<BpPanelSnapshot | null>('get_bp_panel')
      if (gen !== pollGeneration) return
      // 同一份快照不能反复重置插值基准，否则倒计时会每秒回跳
      if (next !== null && !deepEqual(next, snapshot.value)) {
        baseAt.value = Date.now()
        now.value = baseAt.value
      }
      snapshot.value = next
    } catch {
      // 命令未就绪 / 客户端未连接：静默保持上一帧
    }
  }

  function stop(): void {
    pollGeneration++
    if (pollTimer) clearInterval(pollTimer)
    if (tickTimer) clearInterval(tickTimer)
    pollTimer = null
    tickTimer = null
    snapshot.value = null
    baseAt.value = 0
  }

  function start(): void {
    if (pollTimer) return
    loadChampionNames()
      .then(() => {
        namesReady.value = true
      })
      .catch(() => {
        // 名字取不到时卡片退回占位文案，不影响操作
      })
    if (championOptions.value.length === 0) {
      invoke<BpChampionOption[]>('get_champion_options')
        .then(list => {
          championOptions.value = list.map(o => ({ value: o.value, label: o.label }))
        })
        .catch(() => {
          // 搜索框没有选项时仍可点推荐卡片
        })
    }
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

  function report(e: unknown): void {
    options.onError?.(e instanceof Error ? e.message : String(e))
  }

  async function hover(championId: number): Promise<void> {
    localHoverId.value = championId
    try {
      await invoke('bp_hover', { championId })
    } catch (e) {
      report(e)
    }
  }

  async function confirm(): Promise<void> {
    const championId = view.value?.hoveredId
    if (!championId) return
    localConfirmed.value = true
    try {
      await invoke('bp_confirm', { championId })
      void poll()
    } catch (e) {
      // 没提交成功：动作还开着，自动兜底也还在
      localConfirmed.value = false
      report(e)
    }
  }

  return { view, secsLeft, totalSecs, championOptions, hover, confirm }
}
