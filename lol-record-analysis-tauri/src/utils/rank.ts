/**
 * 段位相关的纯函数：胜率计算、段位/点数展示
 */

import type { QueueInfo } from '@renderer/types/domain/player'

export function winRate(wins: number, losses: number) {
  const totalFlexGames = wins + losses
  if (totalFlexGames === 0) {
    return 0
  }
  return Math.round((wins / totalFlexGames) * 100)
}

export const divisionOrPoint = (queueInfo: QueueInfo) => {
  const highTire = ['MASTER', 'GRANDMASTER', 'CHALLENGER']
  if (highTire.includes(queueInfo.tier)) {
    return queueInfo.leaguePoints
  }
  return queueInfo.division
}

/**
 * 是否有有效段位。
 * LCU 未定级时 tier 为 "UNRANKED"（或缺失时为空串）、division 为 "NA"，
 * 直接拼接会渲染出「无 NA」这种半成品文案。
 */
export const hasRealTier = (queueInfo: QueueInfo) =>
  !!queueInfo.tier && queueInfo.tier !== 'UNRANKED' && queueInfo.tier !== 'NONE'

/**
 * 段位展示文案：`中文段位 分段/胜点`，未定级统一显示「无段位」
 * @param queueInfo - 单个队列的段位信息
 * @param opts.short - 中文段位只取后两字（如「华贵铂金」→「铂金」），用于空间紧张的卡片
 */
export const formatTierText = (queueInfo: QueueInfo, opts?: { short?: boolean }) => {
  if (!hasRealTier(queueInfo)) return '无段位'
  const tier = opts?.short ? queueInfo.tierCn.slice(-2) : queueInfo.tierCn
  return `${tier} ${divisionOrPoint(queueInfo)}`
}
