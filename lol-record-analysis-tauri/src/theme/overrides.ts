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
  const radiusSm = cssVar('--radius-sm', '6px')
  const radiusMd = cssVar('--radius-md', '8px')
  const radiusLg = cssVar('--radius-lg', '12px')
  const radiusPill = cssVar('--radius-pill', '999px')
  const space8 = cssVar('--space-8', '8px')
  const space12 = cssVar('--space-12', '12px')
  // Theme-dependent values can't go through cssVar() — .theme-light class is on
  // n-config-provider's root, not document.documentElement, so getComputedStyle
  // always returns :root values. Use isDark ternaries directly (matches pre-refactor behavior).
  const bgBase = isDark ? '#0d0d0f' : '#f0f2f5'
  const glassMid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)'
  const glassBorder = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'
  const shadowMd = isDark ? '0 2px 8px rgba(0,0,0,0.45)' : '0 2px 8px rgba(0,0,0,0.12)'
  const semanticWin = isDark ? '#3d9b7a' : '#2d8a6c'

  return {
    common: {
      borderRadius: radiusMd,
      borderRadiusSmall: radiusSm
    },
    Card: {
      borderRadius: radiusLg,
      color: glassMid,
      boxShadow: shadowMd,
      borderColor: glassBorder
    },
    Input: {
      borderRadius: radiusMd,
      color: glassMid,
      border: `1px solid ${glassBorder}`
    },
    Button: {
      borderRadiusSmall: radiusSm,
      borderRadiusMedium: radiusMd
    },
    Select: {
      borderRadius: radiusMd
    },
    Pagination: {
      itemBorderRadius: radiusMd
    },
    Tag: {
      borderRadius: radiusPill
    },
    Tooltip: {
      borderRadius: radiusMd,
      padding: `${space8} ${space12}`
    },
    Popover: {
      borderRadius: radiusMd
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
