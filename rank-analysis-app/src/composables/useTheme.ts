/**
 * 主题管理 Composable
 * 提供暗黑模式检测和主题相关工具
 */
import { computed } from 'vue'
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
