import { defineStore } from 'pinia'
import { ref } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref(darkTheme)

  /** 从持久化配置拉取主题，由 main.ts 在 app 启动时显式调用 */
  async function initTheme() {
    try {
      const savedTheme = await getConfigByIpc<string>('theme')
      theme.value = savedTheme === 'light' ? lightTheme : darkTheme
    } catch (error) {
      console.error('Failed to load theme config:', error)
    }
  }

  async function toggleTheme() {
    if (theme.value.name == 'dark') {
      theme.value = lightTheme
      await putConfigByIpc('theme', 'light')
    } else {
      theme.value = darkTheme
      await putConfigByIpc('theme', 'dark')
    }
  }

  return { theme, toggleTheme, initTheme }
})
