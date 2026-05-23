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
  const bgBase = cssVar('--bg-base', isDark ? '#0d0d0f' : '#f0f2f5')
  const glassMid = cssVar('--glass-bg-mid', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)')
  const glassBorder = cssVar(
    '--glass-border',
    isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'
  )
  const shadowMd = cssVar('--shadow-md', '0 2px 8px rgba(0,0,0,0.45)')
  const semanticWin = cssVar('--semantic-win', isDark ? '#3d9b7a' : '#2d8a6c')

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
