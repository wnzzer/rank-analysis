/**
 * 窗口控制 Composable
 * 提供 Tauri 窗口的最小化、最大化、关闭等控制功能
 *
 * 非 Tauri 环境（纯前端浏览器 dev / 单测）返回空实现：无窗口后端，
 * 裸调 getCurrentWindow 会在启动时抛错导致整树渲染失败。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'

function hasTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function useWindowControls() {
  if (!hasTauri()) {
    const noop = async (): Promise<void> => {}
    return {
      minimize: noop,
      toggleMaximize: noop,
      close: noop,
      setAlwaysOnTop: async (_alwaysOnTop: boolean): Promise<void> => {}
    }
  }

  const appWindow = getCurrentWindow()

  /** 最小化窗口 */
  const minimize = async (): Promise<void> => {
    await appWindow.minimize()
  }

  /** 最大化/还原窗口 */
  const toggleMaximize = async (): Promise<void> => {
    await appWindow.toggleMaximize()
  }

  /** 关闭窗口 */
  const close = async (): Promise<void> => {
    await appWindow.close()
  }

  /** 设置窗口始终置顶 */
  const setAlwaysOnTop = async (alwaysOnTop: boolean): Promise<void> => {
    await appWindow.setAlwaysOnTop(alwaysOnTop)
  }

  return {
    minimize,
    toggleMaximize,
    close,
    setAlwaysOnTop
  }
}
