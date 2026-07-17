/**
 * 根据 sessionData 计算每个玩家展示用的段位图标 + 段位中文
 * 多小队模型：返回 subteamId → TierDisplay[]
 */

import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import type { SessionData, SessionSummoner } from '@renderer/types/domain/gaming'
import { tierImage } from '@renderer/utils/tier-image'
import { formatTierText } from '@renderer/utils/rank'

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
  return { imgUrl: tierImage(q.tier), tierCn: formatTierText(q, { short: true }) }
}

/** 返回 subteamId → TierDisplay[]（按玩家在小队中的顺序） */
export function useSessionTiers(session: MaybeRefOrGetter<SessionData>) {
  return computed<Record<number, TierDisplay[]>>(() => {
    const s = toValue(session)
    const out: Record<number, TierDisplay[]> = {}
    for (const st of s.subteams) {
      out[st.subteamId] = st.players.map(p => toDisplay(p, s.type))
    }
    return out
  })
}
