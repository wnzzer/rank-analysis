/**
 * 启动弹窗队列
 *
 * 把「此刻该显示哪个启动弹窗」收敛成单一 computed：三个弹窗按固定优先级排队，
 * 同一时刻至多一个可见。取代原先散在 Framework.vue 里的布尔标志与「否定掉其它
 * 所有弹窗」式互斥条件——那种写法每加一个弹窗都要回头改所有既有弹窗的条件。
 *
 * 顺序：云同步告知 > 错误上报同意 > 云端配置拉取。前两个是启动期一次性告知，
 * 由本 composable 读写「已展示过」标记；第三个是响应式的（云同步随时可能拉出待
 * 确认配置），只参与排序，收尾仍归 cloudSync store 所有。
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
export type StartupDialogKey = 'cloudSyncNotice' | 'errorReportingConsent' | 'cloudConfigPull'

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

export function useStartupDialogs(): {
  /** 当前应展示的弹窗；null = 都不展示 */
  active: ComputedRef<StartupDialogKey | null>
  resolveCloudSyncNotice: (goto: boolean) => Promise<void>
  resolveErrorReportingConsent: (enabled: boolean) => Promise<void>
} {
  const cloudStore = useCloudSyncStore()

  /** 首屏就绪闸门；未开时 active 恒为 null */
  const gateOpen = ref(false)
  /** 开闸只调度一次（gateOpen 要等 500ms 才翻，不能拿它当去重条件） */
  let gateScheduled = false

  /**
   * 两个一次性告知的「已展示过」内存标记。
   *
   * 初值 true（= 不弹）：配置尚未读回、或读取失败时一律跳过本次启动——读配置失败
   * 属异常态，宁可少弹一次也不重复打扰，下次启动自会重试。裁决时立即置真让 active
   * 前进，不等写盘（见 resolve* 的说明）。
   */
  const noticeShown = ref(true)
  const consentShown = ref(true)

  /** 用户在云同步告知里点了「去看看」：本次启动不再拿另一个模态框打断他看设置页 */
  const consentSuppressed = ref(false)

  /** 战绩详情子窗口（label 前缀 match-detail-）不参与任何启动弹窗 */
  const isDetailWindow = getCurrentWindow().label.startsWith('match-detail-')

  const active = computed<StartupDialogKey | null>(() => {
    if (!gateOpen.value) return null
    if (!noticeShown.value) return 'cloudSyncNotice'
    if (!consentShown.value && !consentSuppressed.value) return 'errorReportingConsent'
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

  /** 读回两个「已展示过」标记；任一读失败按 true 处理 */
  async function loadShownFlags(): Promise<void> {
    const [notice, consent] = await Promise.all([
      getConfigByIpc<boolean>(CONFIG_KEYS.cloudSyncNoticeShown).catch(() => true),
      getConfigByIpc<boolean>(CONFIG_KEYS.errorReportingConsentShown).catch(() => true)
    ])
    noticeShown.value = notice ?? false
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
   * 云同步告知的裁决。
   *
   * 两种选择都视为「已告知」，之后不再弹。先置内存标记再写盘：写盘失败只影响下次
   * 启动还弹不弹，不能把队列卡死在同一个弹窗上。
   *
   * @param goto - true = 用户点了「去看看」，本次启动不再弹错误上报同意
   * @throws 写 cloudSyncNoticeShown 失败时 reject
   */
  async function resolveCloudSyncNotice(goto: boolean): Promise<void> {
    noticeShown.value = true
    if (goto) consentSuppressed.value = true
    await putConfigByIpc(CONFIG_KEYS.cloudSyncNoticeShown, true)
  }

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
    try {
      await putConfigByIpc(CONFIG_KEYS.errorReportingEnabled, enabled)
    } finally {
      // 开关写失败也要记「已问过」，否则每次启动都重复打扰
      putConfigByIpc(CONFIG_KEYS.errorReportingConsentShown, true).catch(() => {})
    }
  }

  return { active, resolveCloudSyncNotice, resolveErrorReportingConsent }
}
