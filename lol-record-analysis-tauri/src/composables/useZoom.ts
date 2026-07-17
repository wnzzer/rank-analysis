/**
 * 浏览器式页面缩放：Ctrl+滚轮、Ctrl+加减号、Ctrl+0 复位
 *
 * 走 WebView2 的布局缩放（webview.setZoom）而非 CSS transform——与 Chrome 缩放
 * 行为一致：CSS 视口宽度随缩放变化，既有的 clamp(100vw) 自适应会自动重算。
 *
 * 比例持久化到 config（settings.ui.zoomFactor），窗口打开时恢复；
 * 各窗口（主窗口 / match-detail-*）独立挂载本 composable，新开窗口
 * 以最近保存的比例启动。已开窗口之间不做实时同步（各自缩各自的）。
 */
import { onMounted, onUnmounted } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'

export const ZOOM_MIN = 0.7
export const ZOOM_MAX = 1.5
/** 每格滚轮/每次按键的缩放乘数（浏览器同款手感的近似值） */
export const ZOOM_STEP = 1.1

const CONFIG_KEY = CONFIG_KEYS.zoomFactor
/** 连续滚动只在停下后落盘一次 */
const SAVE_DEBOUNCE_MS = 600

/**
 * 计算下一档缩放比例（纯函数，便于单测）
 * @param current - 当前比例
 * @param direction - 1 放大 / -1 缩小 / 0 复位到 1
 * @returns 夹取在 [ZOOM_MIN, ZOOM_MAX] 的两位小数比例
 */
export function nextZoomFactor(current: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return 1
  const raw = direction > 0 ? current * ZOOM_STEP : current / ZOOM_STEP
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw))
  return Math.round(clamped * 100) / 100
}

export function useZoom() {
  let factor = 1
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function apply(next: number) {
    factor = next
    try {
      await getCurrentWebview().setZoom(factor)
    } catch (e) {
      console.warn('setZoom failed:', e)
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void putConfigByIpc(CONFIG_KEY, factor)
    }, SAVE_DEBOUNCE_MS)
  }

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return
    e.preventDefault()
    void apply(nextZoomFactor(factor, e.deltaY < 0 ? 1 : -1))
  }

  function onKeydown(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey || e.metaKey) return
    // '=' 兼容不按 shift 的主键盘 '+'
    if (e.key === '=' || e.key === '+') {
      e.preventDefault()
      void apply(nextZoomFactor(factor, 1))
    } else if (e.key === '-') {
      e.preventDefault()
      void apply(nextZoomFactor(factor, -1))
    } else if (e.key === '0') {
      e.preventDefault()
      void apply(1)
    }
  }

  onMounted(async () => {
    try {
      const saved = await getConfigByIpc<number>(CONFIG_KEY)
      if (typeof saved === 'number' && saved >= ZOOM_MIN && saved <= ZOOM_MAX && saved !== 1) {
        await apply(saved)
      }
    } catch {
      // 无保存值：保持 1.0
    }
    // wheel 需 passive:false 才能 preventDefault 掉 WebView2 的默认行为
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKeydown)
    if (saveTimer) clearTimeout(saveTimer)
  })
}
