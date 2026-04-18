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
