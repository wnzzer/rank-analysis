/**
 * 段位相关的纯函数：胜率计算、段位/点数展示
 */

import type { QueueInfo, Rank } from '@renderer/types/domain/player'

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

/**
 * 按本局队列 ID 选择用于展示的段位队列信息。
 *
 * 判据与 `useSessionTiers.ts` 的 `pickQueueInfo` 保持一致（对局页选人阶段的既有逻辑）：
 * 只有灵活组排（440）才用灵活段位，且要求灵活段位确实有 tier 数据，否则回退单双排；
 * 其余队列（含单双排 420 与所有非排位队列，如匹配/大乱斗/斗魂）一律用单双排段位——
 * 这些队列没有对应的排位段位可选，单双排是唯一有意义的参考。
 * @param rank - 段位聚合数据（含 RANKED_SOLO_5x5 / RANKED_FLEX_SR 两个队列）
 * @param queueId - 本局队列 ID（`Game.queueId`）
 * @returns 用于展示的队列段位信息
 */
export const pickQueueInfoByQueueId = (rank: Rank, queueId: number): QueueInfo => {
  const flex = rank.queueMap.RANKED_FLEX_SR
  if (queueId === 440 && flex.tier) return flex
  return rank.queueMap.RANKED_SOLO_5x5
}
