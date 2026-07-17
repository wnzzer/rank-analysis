/**
 * 战绩相关的语义色：KDA、胜率、经济等
 * 亮/暗两套配色保证默认可见
 */

const palette = {
  dark: {
    good: '#8BDFB7',
    bad: '#BA3F53',
    neutral: 'rgba(255, 255, 255, 0.7)'
  },
  light: {
    good: '#2d8a6c',
    bad: '#b84242',
    // 冷墨而非纯黑：纯黑 60% 在浅色卡面上是一根「脏黑棒」
    neutral: 'rgba(20, 30, 35, 0.55)'
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
