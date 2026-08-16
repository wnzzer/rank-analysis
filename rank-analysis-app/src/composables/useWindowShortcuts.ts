/**
 * 多窗口快捷键：Ctrl+W 关闭当前战绩子窗口，Ctrl+Tab 循环切换窗口。
 * - Ctrl+W 仅对战绩子窗口（record-*）生效，主窗口不响应 —— 避免误关主窗退出应用。
 * - 在 Framework 顶层注册，所有窗口（主窗/子窗）共用同一套快捷键。
 */
import { onMounted, onUnmounted } from 'vue'
import { cycleWindows, closeCurrentRecordWindow } from '@renderer/utils/windows'

export function useWindowShortcuts() {
  function onKeydown(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey || e.metaKey) return
    const key = e.key.toLowerCase()
    if (key === 'w') {
      e.preventDefault()
      void closeCurrentRecordWindow()
    } else if (key === 'tab') {
      e.preventDefault()
      void cycleWindows()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
  })
}
