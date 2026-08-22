/**
 * 对局浮窗偏好（设计系统 v3 §C7）。
 *
 * 存 localStorage（主窗设置页写入，overlay 窗口同源读取）；
 * 后端 overlay:config 事件若推送则覆盖本地值（事件是权威源）。
 */
export interface OverlayPrefs {
  /** 建议条最大条数 */
  maxItems: number
  /** 卡片不透明度 0.5~1 */
  opacity: number
}

const KEY = 'ra.overlay.prefs'

const DEFAULTS: OverlayPrefs = { maxItems: 3, opacity: 0.9 }

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function loadOverlayPrefs(): OverlayPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<OverlayPrefs>
    return {
      maxItems: clamp(Number(p.maxItems ?? DEFAULTS.maxItems), 1, 6),
      opacity: clamp(Number(p.opacity ?? DEFAULTS.opacity), 0.5, 1)
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveOverlayPrefs(prefs: OverlayPrefs): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        maxItems: clamp(Math.round(prefs.maxItems), 1, 6),
        opacity: clamp(prefs.opacity, 0.5, 1)
      })
    )
  } catch {
    /* 忽略：隐私模式等场景下静默失败即可 */
  }
}
