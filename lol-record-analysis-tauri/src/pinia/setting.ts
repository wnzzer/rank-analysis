import { defineStore } from 'pinia'
import { ref } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref(darkTheme)

  const initTheme = async () => {
    try {
      const savedTheme = await invoke<string>('get_config', { key: 'theme' })
      if (savedTheme === 'light') {
        theme.value = lightTheme
      } else {
        theme.value = darkTheme
      }
    } catch (error) {
      console.error('Failed to load theme config:', error)
    }
  }

  // Initialize theme
  initTheme()

  // 方法用于切换主题
  async function toggleTheme() {
    if (theme.value.name == 'dark') {
      theme.value = lightTheme
      await invoke('put_config', { key: 'theme', value: 'light' })
    } else {
      theme.value = darkTheme
      await invoke('put_config', { key: 'theme', value: 'dark' })
    }
  }

  return {
    theme,
    toggleTheme
  }
})
