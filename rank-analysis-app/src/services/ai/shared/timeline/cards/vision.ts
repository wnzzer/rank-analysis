/**
 * 视野卡（V）：有分路模式下，每位玩家每 10 分钟的插眼/排眼数与真眼总数。
 * wardType=UNDEFINED（非真实守卫，如部分英雄召唤物）不计。
 */
import type { CardDraft, CardInput } from '../types'

const BUCKET_MS = 600000

/** 生成视野卡（weight 固定 0.5） */
export function buildVisionCards(input: CardInput): CardDraft[] {
  if (!input.hasLanes) return []
  const { tl, roster } = input
  const lastTs = tl.frames.length ? tl.frames[tl.frames.length - 1].timestamp : 0
  const buckets = Math.max(1, Math.ceil(lastTs / BUCKET_MS))
  return roster.map(me => {
    const placed = new Array(buckets).fill(0)
    const killed = new Array(buckets).fill(0)
    let control = 0
    for (const e of tl.events) {
      const b = Math.min(buckets - 1, Math.floor(e.timestamp / BUCKET_MS))
      if (
        e.type === 'WARD_PLACED' &&
        e.creatorId === me.participantId &&
        e.wardType !== 'UNDEFINED'
      ) {
        placed[b]++
        if (e.wardType === 'CONTROL_WARD') control++
      }
      if (e.type === 'WARD_KILL' && e.killerId === me.participantId) killed[b]++
    }
    const parts = placed.map((p, i) => `${i * 10}-${(i + 1) * 10}分钟 插眼${p} 排眼${killed[i]}`)
    return {
      kind: 'vision' as const,
      subjects: [me.participantId],
      minute: 0,
      weight: 0.5,
      text: `${me.champion} 视野｜${parts.join('｜')}｜真眼 ${control}`
    }
  })
}
