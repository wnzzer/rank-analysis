/**
 * 启动弹窗队列
 *
 * 把「此刻该显示哪个启动弹窗」收敛成单一 computed：目前队列里只剩错误上报
 * 同意这一个一次性告知弹窗。取代原先散在 Framework.vue 里的布尔标志与「否定掉
 * 其它所有弹窗」式互斥条件——那种写法每加一个弹窗都要回头改所有既有弹窗的条件。
 *
 * 曾经还排过另外两个弹窗，均已移出本队列：
 * - 「云同步功能一次性告知」——纯告知无决策，用户反馈打扰，直接砍掉
 *   （见 CloudSyncNoticeDialog 删除记录）。
 * - 「云端配置拉取裁决」——真正的裁决框，但改成被动角标引导：待裁决时左侧
 *   「设置」导航项 + 设置页「数据与同步」菜单项挂呼吸角标，用户主动点进
 *   数据与同步页里的入口才弹出（组件仍是 CloudConfigPullDialog，只是不再
 *   占启动弹窗队列的位置，见 views/settings/DataSync.vue）。
 *
 * 曾经还有一段「交接留白」机制（handingOff + HANDOFF_MS）：弹窗裁决后先留白
 * 一小段时间再把 active 推进到队列里的下一个弹窗，给 n-modal 的离场动画留
 * 出时间，避免下一个弹窗紧接着弹出造成视觉跳变。队列缩到只剩一个弹窗后，
 * resolveErrorReportingConsent 一开始就同步把 consentShown 置真，active 在
 * 那一刻已经变 null——留白期无论加不加，active 的值都不再变化，机制本身
 * 已经测不出差异，遂删除。如果队列以后再变回多个弹窗，这段留白逻辑值得
 * 重新设计（比如用「正在离场的弹窗 key」而非一个全局布尔），而不是简单地
 * 照抄回来——原实现的置位顺序（先置 consentShown 再 beginHandoff）本身就
 * 让留白窗口形同虚设，新实现要吸取这个教训。
 *
 * @module composables/useStartupDialogs
 */
import { computed, onMounted, ref, watch, type ComputedRef } from 'vue'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'
import { lcuConnected } from '@renderer/composables/useGameState'

/** 队列里的弹窗标识 */
export type StartupDialogKey = 'errorReportingConsent'

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
  resolveErrorReportingConsent: (enabled: boolean) => Promise<void>
} {
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

  const active = computed<StartupDialogKey | null>(() => {
    if (!gateOpen.value) return null
    if (!consentShown.value) return 'errorReportingConsent'
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

  /** 读回「已展示过」标记；读失败按 true 处理 */
  async function loadShownFlags(): Promise<void> {
    const consent = await getConfigByIpc<boolean>(CONFIG_KEYS.errorReportingConsentShown).catch(
      () => true
    )
    consentShown.value = consent ?? false
  }

  onMounted(() => {
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
    try {
      await putConfigByIpc(CONFIG_KEYS.errorReportingEnabled, enabled)
    } finally {
      // 开关写失败也要记「已问过」，否则每次启动都重复打扰
      putConfigByIpc(CONFIG_KEYS.errorReportingConsentShown, true).catch(() => {})
    }
  }

  return { active, resolveErrorReportingConsent }
}
