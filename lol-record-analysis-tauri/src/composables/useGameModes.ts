/**
 * 全局共享的游戏模式列表：从后端拉取一次，供筛选器使用
 */

import { ref } from 'vue'
import { getGameModesByIpc } from '@renderer/services/ipc'

export const modeOptions = ref([{ label: '全部', value: 0, key: 0 }])

export async function initModeOptions() {
  try {
    const modes = await getGameModesByIpc()
    modeOptions.value = modes.map(m => ({ ...m, key: m.value }))
  } catch (e) {
    console.error('Failed to fetch game modes', e)
  }
}
