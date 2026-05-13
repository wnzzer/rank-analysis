import { defineStore } from 'pinia'
import { ref } from 'vue'
import { darkTheme, lightTheme } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref(darkTheme)

  /**
   * 从持久化配置拉取主题，由 main.ts 在 app 启动时显式调用。
   *
   * 注意：theme 这一项历史上以**裸字符串**形式持久化（不是 `{ value: '...' }` 包装），
   * 因此走原生 invoke 而不是 services/ipc.ts 的 getConfigByIpc helper
   * （后者会试图解 `.value`，对 theme 这种 scalar 会拿到 undefined）。
   */
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
