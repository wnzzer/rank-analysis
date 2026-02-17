import router from '../../router'
import { ref } from 'vue'
import { getGameModesByIpc } from '../../services/ipc'

/** 亮/暗两套语义色，保证默认情况下也可见 */
const palette = {
  dark: {
    good: '#8BDFB7',
    bad: '#BA3F53',
    /** 默认/中间状态：深色背景下可见 */
    neutral: 'rgba(255, 255, 255, 0.7)'
  },
  light: {
    good: '#2d8a6c',
    bad: '#b84242',
    /** 默认/中间状态：浅色背景下可见 */
    neutral: 'rgba(0, 0, 0, 0.6)'
  }
}

function colors(isDark: boolean) {
  return isDark ? palette.dark : palette.light
}

export const kdaColor = (kda: number, isDark = true) => {
  const c = colors(isDark)
  if (kda >= 2.6) return c.good
  if (kda <= 1.3) return c.bad
  return c.neutral
}

/**
 * Returns a color based on the number of kills.
 * - Green for 8 or more kills.
 * - Red for 3 or fewer kills.
 */
export const killsColor = (kills: number, isDark = true) => {
  const c = colors(isDark)
  if (kills >= 8) return c.good
  if (kills <= 3) return c.bad
  return c.neutral
}

export const deathsColor = (deaths: number, isDark = true) => {
  const c = colors(isDark)
  if (deaths >= 8) return c.bad
  if (deaths <= 3) return c.good
  return c.neutral
}

export const assistsColor = (assists: number, isDark = true) => {
  const c = colors(isDark)
  if (assists >= 10) return c.good
  if (assists <= 3) return c.bad
  return c.neutral
}

export const groupRateColor = (groupRate: number, isDark = true) => {
  const c = colors(isDark)
  if (groupRate >= 45) return c.good
  if (groupRate <= 15) return c.bad
  return c.neutral
}

export const healColorAndTaken = (other: number, isDark = true) => {
  const c = colors(isDark)
  if (other >= 25) return c.good
  return c.neutral
}

export const otherColor = (other: number, isDark = true) => {
  const c = colors(isDark)
  if (other >= 25) return c.good
  if (other <= 15) return c.bad
  return c.neutral
}

export const winRateColor = (winRate: number, isDark = true) => {
  const c = colors(isDark)
  if (winRate >= 57) return c.good
  if (winRate <= 49) return c.bad
  return c.neutral
}
export function winRate(wins: number, losses: number) {
  const totalFlexGames = wins + losses
  if (totalFlexGames === 0) {
    return 0 // 或者可以选择返回 null、-1、或者其他你认为合适的值
  }
  return Math.round((wins / totalFlexGames) * 100)
}

export function searchSummoner(nameId: string) {
  router.push({
    path: '/Record',
    query: { name: nameId, t: Date.now() } // 添加动态时间戳作为查询参数
  })
}

export const modeOptions = ref([{ label: '全部', value: 0, key: 0 }])

export async function initModeOptions() {
  try {
    const modes = await getGameModesByIpc()
    // Ensure '全部' is always there if backend doesn't provide it, or just overwrite.
    // Backend provides '全部' (value 0).
    modeOptions.value = modes.map(m => ({ ...m, key: m.value }))
  } catch (e) {
    console.error('Failed to fetch game modes', e)
  }
}
