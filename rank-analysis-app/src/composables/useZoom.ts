/**
 * 浏览器式页面缩放：Ctrl+滚轮、Ctrl+加减号、Ctrl+0 复位
 *
 * 主窗口走 WebView2 的布局缩放（webview.setZoom）而非 CSS transform——与 Chrome 缩放
 * 行为一致：CSS 视口宽度随缩放变化，既有的 clamp(100vw) 自适应会自动重算。
 * 比例持久化到 config（settings.ui.zoomFactor），由 boot 流程在 **mount 前**恢复
 * （{@link applySavedWindowZoom}）——实测此前在 onMounted 里补应用，首帧先按 1 倍
 * 画出来再整页跳一下。
 *
 * 对局详情窗不走这里的 webview 缩放，而是 useDetailZoom 的 CSS zoom 铺满 + 倍率；
 * 两者共用本模块的热键解析、步进与防抖落盘。
 */
import { onMounted, onUnmounted } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'

export const ZOOM_MIN = 0.7
export const ZOOM_MAX = 1.5
/** 每格滚轮/每次按键的缩放乘数（浏览器同款手感的近似值） */
export const ZOOM_STEP = 1.1

/** 连续滚动只在停下后落盘一次 */
const SAVE_DEBOUNCE_MS = 600

/** 缩放方向：1 放大 / -1 缩小 / 0 复位 */
export type ZoomDirection = 1 | -1 | 0

/**
 * 计算下一档缩放比例（纯函数，便于单测）
 * @param current - 当前比例
 * @param direction - 1 放大 / -1 缩小 / 0 复位到 1
 * @returns 夹取在 [ZOOM_MIN, ZOOM_MAX] 的两位小数比例
 */
export function nextZoomFactor(current: number, direction: ZoomDirection): number {
  if (direction === 0) return 1
  const raw = direction > 0 ? current * ZOOM_STEP : current / ZOOM_STEP
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw))
  return Math.round(clamped * 100) / 100
}

/**
 * 已存比例是否可用（落在 [ZOOM_MIN, ZOOM_MAX] 内的数字）
 * @param value - 从 config 读出的原始值
 */
export function isValidZoomFactor(value: unknown): value is number {
  return typeof value === 'number' && value >= ZOOM_MIN && value <= ZOOM_MAX
}

/**
 * 把键鼠事件解析成缩放方向（纯函数，便于单测）
 * @param e - wheel 或 keydown 事件
 * @returns 非缩放事件返回 null
 */
export function zoomDirectionOf(e: WheelEvent | KeyboardEvent): ZoomDirection | null {
  if (!e.ctrlKey) return null
  if (e.type === 'wheel') {
    const { deltaY } = e as WheelEvent
    if (deltaY === 0) return null
    return deltaY < 0 ? 1 : -1
  }
  const k = e as KeyboardEvent
  if (k.altKey || k.metaKey) return null
  // '=' 兼容不按 shift 的主键盘 '+'
  if (k.key === '=' || k.key === '+') return 1
  if (k.key === '-') return -1
  if (k.key === '0') return 0
  return null
}

/**
 * 注册缩放热键：mount 时挂到 window，unmount 时摘除
 * @param onStep - 命中缩放热键时回调（事件已 preventDefault）
 */
export function useZoomHotkeys(onStep: (direction: ZoomDirection) => void): void {
  function handler(e: WheelEvent | KeyboardEvent) {
    const direction = zoomDirectionOf(e)
    if (direction === null) return
    e.preventDefault()
    onStep(direction)
  }

  onMounted(() => {
    // wheel 需 passive:false 才能 preventDefault 掉 WebView2 的默认行为
    window.addEventListener('wheel', handler, { passive: false })
    window.addEventListener('keydown', handler)
  })

  onUnmounted(() => {
    window.removeEventListener('wheel', handler)
    window.removeEventListener('keydown', handler)
  })
}

/**
 * 防抖落盘器：连续调整只在停下 SAVE_DEBOUNCE_MS 后写一次 config
 * @param key - config 键
 */
export function createDebouncedSave(key: string) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: number | null = null

  function flush(): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending === null) return
    void putConfigByIpc(key, pending)
    pending = null
  }

  return {
    save(value: number): void {
      pending = value
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    /** 立即写出未落盘的值（组件卸载/窗口关闭前调用，避免刚调的比例丢失） */
    flush
  }
}

/** 主窗口当前 webview 缩放比例：applySavedWindowZoom 恢复、useZoom 调整 */
let windowZoom = 1

/**
 * mount 前恢复主窗口已存的缩放比例（由 boot 流程调用）
 *
 * 失败或无保存值时保持 1 倍且不抛错——缩放不是启动的必要条件。
 */
export async function applySavedWindowZoom(): Promise<void> {
  try {
    const saved = await getConfigByIpc<number>(CONFIG_KEYS.zoomFactor)
    if (!isValidZoomFactor(saved) || saved === 1) return
    await getCurrentWebview().setZoom(saved)
    windowZoom = saved
  } catch (e) {
    console.warn('restore window zoom failed:', e)
  }
}

/** 主窗口缩放热键：Ctrl+滚轮 / Ctrl± / Ctrl+0 → webview.setZoom + 防抖落盘 */
export function useZoom(): void {
  const saver = createDebouncedSave(CONFIG_KEYS.zoomFactor)

  useZoomHotkeys(direction => {
    const next = nextZoomFactor(windowZoom, direction)
    windowZoom = next
    getCurrentWebview()
      .setZoom(next)
      .then(() => saver.save(next))
      .catch(e => console.warn('setZoom failed:', e))
  })

  onUnmounted(() => saver.flush())
}
