/**
 * 对局浮窗偏好（设计系统 v3 §C7）。
 *
 * 存 localStorage（主窗设置页写入，overlay 窗口同源读取，是持久化的权威源）；
 * 主窗口前端经 `emit('overlay:config')` 广播的实时变更若到达则覆盖本地值
 * （后端不发射此事件；overlay 尚未创建时的广播会丢失，由 localStorage 兜底）。
 */
export interface OverlayPrefs {
  /** 建议条最大条数 */
  maxItems: number
  /** 卡片不透明度 0.5~1 */
  opacity: number
  /** 全局热键 Alt+A 开关浮窗（B1） */
  hotkeyEnabled: boolean
  /** 浮窗锚点 */
  anchor: 'top-left' | 'top-center' | 'top-right'
}

const KEY = 'ra.overlay.prefs'
const ANCHORS = ['top-left', 'top-center', 'top-right'] as const

const DEFAULTS: OverlayPrefs = {
  maxItems: 3,
  opacity: 0.9,
  hotkeyEnabled: true,
  anchor: 'top-center'
}

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
      opacity: clamp(Number(p.opacity ?? DEFAULTS.opacity), 0.5, 1),
      hotkeyEnabled:
        typeof p.hotkeyEnabled === 'boolean' ? p.hotkeyEnabled : DEFAULTS.hotkeyEnabled,
      anchor: ANCHORS.includes(p.anchor as (typeof ANCHORS)[number])
        ? (p.anchor as OverlayPrefs['anchor'])
        : DEFAULTS.anchor
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
        opacity: clamp(prefs.opacity, 0.5, 1),
        hotkeyEnabled: prefs.hotkeyEnabled,
        anchor: ANCHORS.includes(prefs.anchor) ? prefs.anchor : DEFAULTS.anchor
      })
    )
  } catch {
    /* 忽略：隐私模式等场景下静默失败即可 */
  }
}
