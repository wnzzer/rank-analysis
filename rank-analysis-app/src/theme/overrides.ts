import type { GlobalThemeOverrides } from 'naive-ui'

/** 读取一个 CSS token 的计算值 */
export type TokenReader = (name: string) => string

/**
 * 默认读取器：从 `<html>` 读计算后的 token
 *
 * `theme-light` 类挂在 `<html>` 上（见 useTheme.syncThemeClass），这里读到的就是当前
 * 主题的值；自定义属性的计算值已替换内部 var() 引用。
 */
export const readRootToken: TokenReader = name =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/**
 * 构建 naive-ui 主题覆盖
 *
 * 颜色全部经 token 读取，单一数据源在 global.css（`:root` 暗色 / `.theme-light` 亮色）。
 * 被读取的 token 必须是字面色值（hex / rgba）：naive 会对 common.* 等键做 JS 颜色运算，
 * `color-mix()` / `var()` 字符串会让其运行时报错（seemly 解析器直接 throw）。
 * @param read - token 读取器，默认读 `<html>`，测试时注入
 */
export function buildThemeOverrides(read: TokenReader = readRootToken): GlobalThemeOverrides {
  const radiusControl = read('--radius-control')
  const radiusOverlay = read('--radius-overlay')
  const radiusMd = read('--radius-md')
  const radiusLg = read('--radius-lg')
  const fontSizeBase = read('--font-size-base')
  const win = read('--semantic-win')
  const accentHover = read('--accent-hover')
  const textPrimary = read('--text-primary')
  const glassBorder = read('--glass-border')
  const controlBorder = read('--border-control')
  const controlBorderHover = read('--border-control-hover')

  return {
    common: {
      borderRadius: radiusControl,
      borderRadiusSmall: read('--radius-xs'),
      fontSize: fontSizeBase,
      fontSizeMedium: fontSizeBase,
      heightMedium: '28px',
      heightSmall: '24px',
      // 主色统一到应用强调色，hover/pressed 逐级变深（Int UI 惯例，与 macOS 提亮相反）
      primaryColor: win,
      primaryColorHover: accentHover,
      primaryColorPressed: read('--accent-pressed'),
      primaryColorSuppl: accentHover
    },
    Card: {
      borderRadius: radiusLg,
      color: read('--surface-card'),
      boxShadow: read('--shadow-md'),
      borderColor: glassBorder
    },
    Input: {
      // 输入/筛选类控件用 8px 档：比 JB 的 4px 控件档更圆润（用户口味），按钮仍走 4px
      borderRadius: radiusMd,
      color: read('--surface-input'),
      border: `1px solid ${glassBorder}`,
      borderFocus: `1px solid ${win}`,
      boxShadowFocus: `0 0 0 2px ${read('--focus-ring-soft')}`
    },
    Button: {
      borderRadiusSmall: radiusControl,
      borderRadiusMedium: radiusControl,
      // 默认（secondary）按钮 = 镂空描边：透明底 + 1px 边，hover 只提亮边框
      color: 'transparent',
      colorHover: 'transparent',
      colorFocus: 'transparent',
      colorPressed: read('--glass-bg-mid'),
      border: `1px solid ${controlBorder}`,
      borderHover: `1px solid ${controlBorderHover}`,
      borderFocus: `1px solid ${controlBorderHover}`,
      borderPressed: `1px solid ${controlBorderHover}`,
      textColorHover: textPrimary,
      textColorFocus: textPrimary,
      textColorPressed: textPrimary
    },
    Select: {
      borderRadius: radiusMd
    },
    Pagination: {
      itemBorderRadius: radiusControl
    },
    Tag: {
      borderRadius: read('--radius-pill')
    },
    Tooltip: {
      borderRadius: radiusOverlay,
      padding: `${read('--space-8')} ${read('--space-12')}`
    },
    Popover: {
      borderRadius: radiusOverlay
    },
    Dropdown: {
      borderRadius: radiusOverlay
    },
    Skeleton: {
      borderRadius: radiusMd
    },
    Layout: {
      color: read('--bg-base')
    },
    Menu: {
      itemColorActive: read('--menu-item-active'),
      itemColorActiveHover: read('--menu-item-active-hover'),
      itemBorderRadius: radiusLg,
      itemTextColorActive: win,
      itemIconColorActive: win
    }
  }
}
