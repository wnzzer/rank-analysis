/**
 * 赛后右下角弹卡的窗口识别、跳转与打点（Rust 侧见 src-tauri/src/postgame_toast.rs）。
 *
 * 弹卡窗口由 Rust 在排位结算时隐藏创建，label 为 `postgame-toast-{gameId}`；
 * 页面取到数据后自己 show，取不到 / 重开局自己关。
 *
 * @module services/postGameToast
 */
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 弹卡窗口 label 前缀；与 Rust `TOAST_LABEL_PREFIX`、capability `postgame-toast-*` 一致 */
export const POSTGAME_TOAST_LABEL_PREFIX = 'postgame-toast-'

/** 弹卡要主窗口跳页时 Rust 发给主窗口的事件（payload 为路由路径） */
export const POSTGAME_TOAST_NAVIGATE_EVENT = 'postgame-toast-navigate'

/** 设置键：是否开启赛后弹卡（缺省视为开启）；与 Rust `CONFIG_KEY` 一致 */
export const POSTGAME_TOAST_CONFIG_KEY = 'postGameToast'

/** 无交互时自动关闭的时长 */
export const POSTGAME_TOAST_TTL_MS = 25_000

/** 数据一直取不到时放弃（窗口隐藏着，放弃即关闭，不打扰） */
export const POSTGAME_TOAST_GIVE_UP_MS = 90_000

/** 弹卡打点动作（Rust 侧白名单映射为静态功能名） */
export type PostGameToastAction = 'shown' | 'guess' | 'open' | 'copied' | 'closed' | 'expired'

/** 当前 webview 是否为赛后弹卡窗口 */
export function isPostGameToastWindow(): boolean {
  try {
    return getCurrentWindow().label.startsWith(POSTGAME_TOAST_LABEL_PREFIX)
  } catch {
    // 非 Tauri 环境（单测 / 浏览器预览）
    return false
  }
}

/** 打点；上报关闭或非 Tauri 环境时静默失败 */
export function trackPostGameToast(action: PostGameToastAction): void {
  invoke('track_postgame_toast', { action }).catch(() => {
    // 打点失败不影响功能
  })
}

/** 把主窗口拉到前台并跳到对局页，然后关掉弹卡（Rust 一并处理） */
export async function openMainFromToast(): Promise<void> {
  await invoke('postgame_toast_open_main')
}

/** 关掉弹卡窗口 */
export async function closeToastWindow(): Promise<void> {
  try {
    await getCurrentWindow().close()
  } catch (e) {
    console.warn('close post-game toast failed:', e)
  }
}

/** 亮出弹卡窗口（Rust 端以 focusable:false 创建，show 不会抢焦点） */
export async function showToastWindow(): Promise<void> {
  try {
    await getCurrentWindow().show()
  } catch (e) {
    console.warn('show post-game toast failed:', e)
  }
}
