/**
 * 启动弹窗队列
 *
 * 把「此刻该显示哪个启动弹窗」收敛成单一 computed：弹窗按固定优先级排队，
 * 同一时刻至多一个可见。取代原先散在 Framework.vue 里的布尔标志与「否定掉其它
 * 所有弹窗」式互斥条件——那种写法每加一个弹窗都要回头改所有既有弹窗的条件。
 *
 * 顺序：错误上报同意 > 云端配置拉取。前者是启动期一次性告知，由本 composable
 * 读写「已展示过」标记；后者是响应式的（云同步随时可能拉出待确认配置），只参与
 * 排序，收尾仍归 cloudSync store 所有。
 *
 * （原「云同步功能一次性告知」弹窗已砍掉——纯告知无决策，用户反馈打扰；
 * 见 CloudSyncNoticeDialog 删除记录。）
 *
 * @module composables/useStartupDialogs
 */
import { computed, onMounted, ref, watch, type ComputedRef } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { lcuConnected } from '@renderer/composables/useGameState'
import { useCloudSyncStore } from '@renderer/pinia/cloudSync'

/** 队列里的弹窗标识 */
export type StartupDialogKey = 'errorReportingConsent' | 'cloudConfigPull'

/** 首屏就绪信号到达后再等这么久开闸，留给首屏渲染/动画落定 */
export const GATE_SETTLE_MS = 500

/**
 * 兜底开闸时刻（自组件挂载起算）。
 *
 * 首屏（Record）依赖客户端连接事件跳转并拉数据，此时弹模态框会打断关键路径、
 * 让人误以为「弹窗导致加载失败」，所以正常路径等 lcuConnected。但用户完全可能
 * 先开工具后开游戏，不设兜底就永远问不到他。
 */
export const GATE_FALLBACK_MS = 8000

/**
 * 两个弹窗之间的交接留白。
 *
 * n-modal 关闭有约 250ms 的离场动画。若下一个弹窗在同一 tick 就打开，实测会有
 * ~200ms 两张卡片同时可见（旧卡 opacity 0.84 缩小、新卡 opacity 0.92 放大），
 * 两张尺寸不同的卡居中重叠，观感上是一次闪烁。压住这段时间，让交接是干净的
 * 「关完再开」。
 */
export const HANDOFF_MS = 300

export function useStartupDialogs(): {
  /** 当前应展示的弹窗；null = 都不展示 */
  active: ComputedRef<StartupDialogKey | null>
  resolveErrorReportingConsent: (enabled: boolean) => Promise<void>
} {
  const cloudStore = useCloudSyncStore()

  /** 首屏就绪闸门；未开时 active 恒为 null */
  const gateOpen = ref(false)
  /** 开闸只调度一次（gateOpen 要等 500ms 才翻，不能拿它当去重条件） */
  let gateScheduled = false

  /**
   * 错误上报同意的「已展示过」内存标记。
   *
   * 初值 true（= 不弹）：配置尚未读回、或读取失败时一律跳过本次启动——读配置失败
   * 属异常态，宁可少弹一次也不重复打扰，下次启动自会重试。裁决时立即置真让 active
   * 前进，不等写盘（见 resolveErrorReportingConsent 的说明）。
   */
  const consentShown = ref(true)

  /** 正处于「上一个弹窗离场」的留白期；期间 active 恒为 null */
  const handingOff = ref(false)

  /** 战绩详情子窗口（label 前缀 match-detail-）不参与任何启动弹窗 */
  const isDetailWindow = getCurrentWindow().label.startsWith('match-detail-')

  const active = computed<StartupDialogKey | null>(() => {
    if (!gateOpen.value || handingOff.value) return null
    if (!consentShown.value) return 'errorReportingConsent'
    if (cloudStore.pendingCloudConfig !== null) return 'cloudConfigPull'
    return null
  })

  /** 开闸（幂等） */
  function scheduleGate(): void {
    if (gateScheduled) return
    gateScheduled = true
    window.setTimeout(() => {
      gateOpen.value = true
    }, GATE_SETTLE_MS)
  }

  /** 让下一个弹窗等上一个的离场动画走完再开 */
  function beginHandoff(): void {
    handingOff.value = true
    window.setTimeout(() => {
      handingOff.value = false
    }, HANDOFF_MS)
  }

  /** 读回「已展示过」标记；读失败按 true 处理 */
  async function loadShownFlags(): Promise<void> {
    const consent = await getConfigByIpc<boolean>(CONFIG_KEYS.errorReportingConsentShown).catch(
      () => true
    )
    consentShown.value = consent ?? false
  }

  onMounted(() => {
    if (isDetailWindow) return
    // 刻意不 await：兜底计时从挂载起算，标记读回后 computed 自然重算
    loadShownFlags()
    if (lcuConnected.value) {
      scheduleGate()
      return
    }
    const stop = watch(lcuConnected, connected => {
      if (connected) {
        stop()
        scheduleGate()
      }
    })
    window.setTimeout(() => {
      stop()
      scheduleGate()
    }, GATE_FALLBACK_MS)
  })

  /**
   * 错误上报同意的裁决。
   *
   * 无论「启用」还是「保持关闭」都把明确选择持久化到 errorReportingEnabled——
   * 否则此前已在设置里开过的用户点「保持关闭」不会真正关掉，与按钮文案不符。
   *
   * @param enabled - true 启用上报，false 保持关闭
   * @throws 写 errorReportingEnabled 失败时 reject，由调用方 toast
   */
  async function resolveErrorReportingConsent(enabled: boolean): Promise<void> {
    consentShown.value = true
    beginHandoff()
    try {
      await putConfigByIpc(CONFIG_KEYS.errorReportingEnabled, enabled)
    } finally {
      // 开关写失败也要记「已问过」，否则每次启动都重复打扰
      putConfigByIpc(CONFIG_KEYS.errorReportingConsentShown, true).catch(() => {})
    }
  }

  return { active, resolveErrorReportingConsent }
}
