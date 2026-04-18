/**
 * 根据 sessionData 计算每个玩家展示用的段位图标 + 段位中文
 * 同时考虑对局模式（灵活组排时优先使用 RANKED_FLEX_SR）
 */

import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import type { SessionData, SessionSummoner } from '@renderer/types/domain/gaming'
import { tierImage } from '@renderer/utils/tier-image'
import { divisionOrPoint } from '@renderer/utils/rank'

export interface TierDisplay {
  imgUrl: string
  tierCn: string
}

function pickQueueInfo(player: SessionSummoner, queueType: string) {
  const solo = player.rank.queueMap.RANKED_SOLO_5x5
  const flex = player.rank.queueMap.RANKED_FLEX_SR
  if (queueType === 'RANKED_FLEX_SR' && flex.tier) return flex
  return solo
}

function toDisplay(player: SessionSummoner, queueType: string): TierDisplay {
  const q = pickQueueInfo(player, queueType)
  const tierCn = q.tierCn ? `${q.tierCn.slice(-2)} ${divisionOrPoint(q)}` : '无'
  return { imgUrl: tierImage(q.tier), tierCn }
}

export function useSessionTiers(session: MaybeRefOrGetter<SessionData>) {
  return computed(() => {
    const s = toValue(session)
    return {
      teamOne: s.teamOne.map(p => toDisplay(p, s.type)),
      teamTwo: s.teamTwo.map(p => toDisplay(p, s.type))
    }
  })
}
