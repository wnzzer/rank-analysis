import { defineStore } from 'pinia'
import { ref } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref(darkTheme)

  /** 从持久化配置拉取主题，由 main.ts 在 app 启动时显式调用 */
  async function initTheme() {
    try {
      const savedTheme = await invoke<string>('get_config', { key: 'theme' })
      theme.value = savedTheme === 'light' ? lightTheme : darkTheme
    } catch (error) {
      console.error('Failed to load theme config:', error)
    }
  }

  async function toggleTheme() {
    if (theme.value.name == 'dark') {
      theme.value = lightTheme
      await invoke('put_config', { key: 'theme', value: 'light' })
    } else {
      theme.value = darkTheme
      await invoke('put_config', { key: 'theme', value: 'dark' })
    }
  }

  return { theme, toggleTheme, initTheme }
})
