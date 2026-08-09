/**
 * 日期格式化 Composable
 * 提供游戏相关的日期格式化工具
 */

/**
 * 格式化对局日期（显示月/日）
 * @param timestamp 时间戳（毫秒）
 * @returns 格式化后的日期字符串，如 "3/15"
 */
export function formatMatchDate(timestamp: number): string {
  const date = new Date(timestamp)
  const month = (date.getMonth() + 1).toString()
  const day = date.getDate().toString().padStart(2, '0')
  return `${month}/${day}`
}

/**
 * 格式化完整日期时间
 * @param timestamp 时间戳（毫秒）
 * @returns 格式化后的日期时间字符串，如 "2024-03-15 14:30"
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

/**
 * 格式化相对时间（如"3小时前"）
 * @param timestamp 时间戳（毫秒）
 * @returns 相对时间字符串
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  return '刚刚'
}

/**
 * 格式化游戏时长（秒转分钟:秒）
 * @param seconds 游戏时长（秒）
 * @returns 格式化后的时长，如 "25:30"
 */
export function formatGameDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const secs = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${secs}`
}
