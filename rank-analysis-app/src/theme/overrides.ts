import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * 读取 CSS 变量值，带 fallback
 *
 * SSR 或首屏 `getComputedStyle` 可能返回空字符串，必须提供 fallback。
 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * 构建 naive-ui 主题 overrides
 *
 * @param isDark 当前是否暗色主题（用于选取 Layout.color 等主题相关 fallback）
 */
export function buildThemeOverrides(isDark: boolean): GlobalThemeOverrides {
  const radiusControl = cssVar('--radius-control', '4px')
  const radiusOverlay = cssVar('--radius-overlay', '8px')
  const radiusMd = cssVar('--radius-md', '8px')
  const radiusLg = cssVar('--radius-lg', '12px')
  const radiusPill = cssVar('--radius-pill', '999px')
  const space8 = cssVar('--space-8', '8px')
  const space12 = cssVar('--space-12', '12px')
  const fontSizeBase = cssVar('--font-size-base', '13px')
  // Theme-dependent values can't go through cssVar() — .theme-light class is on
  // n-config-provider's root, not document.documentElement, so getComputedStyle
  // always returns :root values. Use isDark ternaries directly (matches pre-refactor behavior).
  // 浅色值与 global.css .theme-light 的冷瓷基调保持一致（冷墨 20,30,35）
  const bgBase = isDark ? '#0d0d0f' : '#eff1f3'
  const glassMid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,35,0.04)'
  const glassBorder = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(20,30,35,0.09)'
  const shadowMd = isDark ? '0 2px 8px rgba(0,0,0,0.45)' : '0 4px 10px rgba(20,30,35,0.09)'
  const semanticWin = isDark ? '#3d9b7a' : '#2d8a6c'
  const textPrimary = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(20,30,35,0.94)'
  // 镂空描边控件：静默态细边，hover 只提亮边框（不加底色）
  const controlBorder = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(20,30,35,0.2)'
  const controlBorderHover = isDark ? 'rgba(255,255,255,0.34)' : 'rgba(20,30,35,0.4)'
  // 主色统一到应用强调色（semantic-win），hover/pressed 逐级变深（Int UI 惯例，与 macOS 提亮相反）
  const primary = semanticWin
  const primaryHover = isDark ? '#378b6e' : '#28795f'
  const primaryPressed = isDark ? '#317c62' : '#236a53'
  const focusRing = isDark ? 'rgba(61,155,122,0.35)' : 'rgba(45,138,108,0.35)'

  return {
    common: {
      borderRadius: radiusControl,
      borderRadiusSmall: cssVar('--radius-xs', '3px'),
      fontSize: fontSizeBase,
      fontSizeMedium: fontSizeBase,
      heightMedium: '28px',
      heightSmall: '24px',
      primaryColor: primary,
      primaryColorHover: primaryHover,
      primaryColorPressed: primaryPressed,
      primaryColorSuppl: primaryHover
    },
    Card: {
      borderRadius: radiusLg,
      color: glassMid,
      boxShadow: shadowMd,
      borderColor: glassBorder
    },
    Input: {
      // 输入/筛选类控件用 8px 档:比 JB 的 4px 控件档更圆润(用户口味),按钮仍走 4px
      borderRadius: radiusMd,
      color: glassMid,
      border: `1px solid ${glassBorder}`,
      borderFocus: `1px solid ${primary}`,
      boxShadowFocus: `0 0 0 2px ${focusRing}`
    },
    Button: {
      borderRadiusSmall: radiusControl,
      borderRadiusMedium: radiusControl,
      // 默认（secondary）按钮 = 镂空描边：透明底 + 1px 边，hover 只提亮边框
      color: 'transparent',
      colorHover: 'transparent',
      colorFocus: 'transparent',
      colorPressed: glassMid,
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
      borderRadius: radiusPill
    },
    Tooltip: {
      borderRadius: radiusOverlay,
      padding: `${space8} ${space12}`
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
      color: bgBase
    },
    Menu: {
      itemColorActive: isDark ? 'rgba(61,155,122,0.14)' : 'rgba(45,138,108,0.12)',
      itemColorActiveHover: isDark ? 'rgba(61,155,122,0.18)' : 'rgba(45,138,108,0.18)',
      itemBorderRadius: radiusLg,
      itemTextColorActive: semanticWin,
      itemIconColorActive: semanticWin
    }
  }
}
