/**
 * 对线卡（L）：有分路模式下，每位玩家与同分路对位在 5/10/14 分钟的经济/经验/补刀差，
 * 外加对线期（<14 分钟）镀层、单杀与首次死亡时间。
 */
import { fmtTime, frameAtMinute } from '../geometry'
import type { CardDraft, CardInput, RosterPlayer } from '../types'

const LANES = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
const CHECKPOINTS = [5, 10, 14]
const LANE_PHASE_MS = 14 * 60000

/** 同分路的对面玩家（无分路/缺对位返回 undefined） */
export function laneOpponent(roster: RosterPlayer[], pid: number): RosterPlayer | undefined {
  const me = roster.find(r => r.participantId === pid)
  if (!me || !LANES.has(me.teamPosition)) return undefined
  return roster.find(r => r.teamId !== me.teamId && r.teamPosition === me.teamPosition)
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/**
 * 生成对线卡。
 * @returns weight = 最后一个检查点经济差绝对值 / 500
 */
export function buildLaneCards(input: CardInput): CardDraft[] {
  if (!input.hasLanes) return []
  const { tl, roster } = input
  const out: CardDraft[] = []
  for (const me of roster) {
    const opp = laneOpponent(roster, me.participantId)
    if (!opp) continue
    const parts: string[] = []
    let lastGoldDiff = 0
    for (const m of CHECKPOINTS) {
      const f = frameAtMinute(tl, m)
      const a = f?.players.find(p => p.participantId === me.participantId)
      const b = f?.players.find(p => p.participantId === opp.participantId)
      if (!a || !b) continue
      lastGoldDiff = a.totalGold - b.totalGold
      parts.push(
        `${m}分钟 经济${signed(lastGoldDiff)} 经验${signed(a.xp - b.xp)} 补刀${signed(a.cs - b.cs)}`
      )
    }
    if (parts.length === 0) continue

    let plates = 0
    let solo = 0
    let firstDeath: number | null = null
    for (const e of tl.events) {
      if (e.timestamp >= LANE_PHASE_MS) break
      if (e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === me.participantId) plates++
      if (e.type === 'CHAMPION_KILL') {
        if (
          e.killerId === me.participantId &&
          e.victimId === opp.participantId &&
          e.assisting.length === 0
        )
          solo++
        if (e.victimId === me.participantId && firstDeath === null) firstDeath = e.timestamp
      }
    }
    out.push({
      kind: 'lane',
      subjects: [me.participantId, opp.participantId],
      minute: 0,
      weight: Math.abs(lastGoldDiff) / 500,
      text:
        `${me.champion} 对线（对位 ${opp.champion}）｜对位差值（正=领先）：${parts.join('｜')}` +
        `｜镀层 ${plates}｜单杀 ${solo} 次｜首次死亡 ${firstDeath === null ? '14分钟前未死亡' : fmtTime(firstDeath)}`
    })
  }
  return out
}
