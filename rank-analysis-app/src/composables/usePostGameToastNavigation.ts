/**
 * 主窗口响应赛后弹卡的跳转请求。
 *
 * 弹卡上点「去猜一下 / 看完整战报」时，Rust（`postgame_toast_open_main`）先把主窗口拉到前台，
 * 再发 `postgame-toast-navigate`（payload 为路由路径）；这里把路由切过去。
 * 对局页的战报由 usePostGameReport 跟随阶段自己加载，跳过去即可看到标注卡。
 *
 * @module composables/usePostGameToastNavigation
 */
import { onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { listen } from '@tauri-apps/api/event'
import { POSTGAME_TOAST_NAVIGATE_EVENT } from '@renderer/services/postGameToast'

/** 只接受这些路径，事件载荷不可信时不乱跳 */
export const TOAST_NAV_TARGETS: readonly string[] = ['/Gaming']

/** 在主窗口（Framework）里调用一次 */
export function usePostGameToastNavigation(): void {
  const router = useRouter()
  let unlisten: (() => void) | null = null
  let disposed = false

  listen<string>(POSTGAME_TOAST_NAVIGATE_EVENT, e => {
    if (!TOAST_NAV_TARGETS.includes(e.payload)) return
    if (router.currentRoute.value.path !== e.payload) void router.push(e.payload)
  })
    .then(fn => {
      if (disposed) fn()
      else unlisten = fn
    })
    .catch(() => {
      // 非 Tauri 环境（单测）没有事件系统
    })

  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })
}
