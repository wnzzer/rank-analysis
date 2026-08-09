/**
 * 窗口控制 Composable
 * 提供 Tauri 窗口的最小化、最大化、关闭等控制功能
 */
import { getCurrentWindow } from '@tauri-apps/api/window'

export function useWindowControls() {
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
