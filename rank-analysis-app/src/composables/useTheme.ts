/**
 * 主题管理 Composable
 * 提供暗黑模式检测和主题相关工具
 */
import { computed, watch, type WatchSource } from 'vue'
import { useSettingsStore } from '@renderer/pinia/setting'

export function useTheme() {
  const settingsStore = useSettingsStore()

  /** 是否为暗黑模式 */
  const isDark = computed(() => {
    const themeName = settingsStore.theme?.name
    return themeName === 'Dark' || themeName === 'dark'
  })

  /** 是否为亮色模式 */
  const isLight = computed(() => !isDark.value)

  /** 当前主题名称 */
  const themeName = computed(() => settingsStore.theme?.name || 'dark')

  return {
    isDark,
    isLight,
    themeName
  }
}

/**
 * 把 `theme-light` 类同步到 `<html>`（`flush: 'sync'` + `immediate`）
 *
 * 挂 `<html>` 而非 n-config-provider：teleport 到 body 的浮层（popover / dropdown /
 * modal）才能拿到亮色 token——实测挂在 provider 上时备注面板标题白字压白底。
 * `sync` 保证切换主题时类先翻转，随后重算的 naive 主题覆盖从 `<html>` 读到新 token。
 * @param isDark - 当前是否暗色
 */
export function syncThemeClass(isDark: WatchSource<boolean>): void {
  watch(
    isDark,
    dark => {
      document.documentElement.classList.toggle('theme-light', !dark)
    },
    { flush: 'sync', immediate: true }
  )
}
