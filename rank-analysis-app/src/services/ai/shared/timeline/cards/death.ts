/**
 * 死亡卡（D）：每次英雄阵亡一张——时间、区域、击杀者、伤害来源、
 * 最近队友距离（帧插值，约值）、之后 60 秒内己方丢失的资源/建筑、送出的终结赏金。
 */
import { dist, fmtTime, positionAt } from '../geometry'
import { buildingLabel, monsterLabel, slotLabel, zoneOf } from '../labels'
import type { CardDraft, CardInput, RosterPlayer, SlimTimeline } from '../types'

/** 死后多久内的资源/建筑丢失算作"后果"（毫秒） */
const CONSEQUENCE_WINDOW_MS = 60000

/**
 * 阵亡时刻最近队友的距离（帧插值，约值）。
 * @returns 无任何队友位置数据时为 null
 */
export function nearestAllyDistance(
  tl: SlimTimeline,
  roster: RosterPlayer[],
  victim: RosterPlayer,
  x: number,
  y: number,
  ms: number
): number | null {
  let nearest: number | null = null
  for (const ally of roster) {
    if (ally.teamId !== victim.teamId || ally.participantId === victim.participantId) continue
    const p = positionAt(tl, ally.participantId, ms)
    if (!p) continue
    const d = dist(p.x, p.y, x, y)
    if (nearest === null || d < nearest) nearest = d
  }
  return nearest
}

/**
 * 阵亡后 60 秒内己方丢失的资源/建筑（中文名，按事件顺序）。
 * @param victimTeamId - 死者所在队伍
 * @param ms - 阵亡时刻
 */
export function lossesAfterDeath(tl: SlimTimeline, victimTeamId: number, ms: number): string[] {
  const losses: string[] = []
  for (const later of tl.events) {
    if (later.timestamp <= ms || later.timestamp > ms + CONSEQUENCE_WINDOW_MS) continue
    if (later.type === 'ELITE_MONSTER_KILL' && later.killerTeamId !== victimTeamId) {
      losses.push(monsterLabel(later.monsterType))
    }
    if (later.type === 'BUILDING_KILL' && later.teamId === victimTeamId) {
      losses.push(buildingLabel(later))
    }
  }
  return losses
}

/**
 * 阵亡后 60 秒内己方拿到的资源/建筑数（对面丢的大型野怪归己方、对面被推的建筑）。
 * 与 lossesAfterDeath 同窗口，用于识别「被多人包抄、队友趁机换资源」。
 * @param victimTeamId - 死者所在队伍
 * @param ms - 阵亡时刻
 */
export function gainsAfterDeath(tl: SlimTimeline, victimTeamId: number, ms: number): number {
  let n = 0
  for (const later of tl.events) {
    if (later.timestamp <= ms || later.timestamp > ms + CONSEQUENCE_WINDOW_MS) continue
    if (later.type === 'ELITE_MONSTER_KILL' && later.killerTeamId === victimTeamId) n++
    if (later.type === 'BUILDING_KILL' && later.teamId !== victimTeamId) n++
  }
  return n
}

/**
 * 生成死亡卡。
 * @param input - 提取器输入
 * @returns 每次阵亡一张；weight = 1 + 有后果 2 + 送终结 1
 */
export function buildDeathCards(input: CardInput): CardDraft[] {
  const { tl, roster, mapId } = input
  const byId = new Map(roster.map(r => [r.participantId, r]))
  const out: CardDraft[] = []

  for (const e of tl.events) {
    if (e.type !== 'CHAMPION_KILL') continue
    const victim = byId.get(e.victimId)
    if (!victim) continue

    // 终结者与助攻分开写：塔/小兵终结（killerId 0）时助攻者不能冒充击杀者
    const killerChamp = byId.get(e.killerId)?.champion
    const assistNames = e.assisting
      .map(id => byId.get(id)?.champion)
      .filter((n): n is string => !!n)
    const assistSuffix = assistNames.length ? `（助攻：${assistNames.join('+')}）` : ''
    const killerText = `${killerChamp ?? '防御塔/小兵'}${assistSuffix}`

    const totalDmg = e.damageReceived.reduce((s, d) => s + d.total, 0)
    const sources = e.damageReceived.slice(0, 2).map(d => {
      const champ = byId.get(d.participantId)?.champion ?? '未知'
      const pct = totalDmg > 0 ? Math.round((d.total / totalDmg) * 100) : 0
      const slot = slotLabel(d.topSlot)
      return slot === '其他' ? `${champ}${pct}%` : `${champ}${pct}%（${slot}为主）`
    })
    const sourceText = sources.length ? sources.join('、') : '无明细'

    const nearest = nearestAllyDistance(tl, roster, victim, e.x, e.y, e.timestamp)
    const allyText =
      nearest === null ? '队友位置未知' : `最近队友约 ${Math.round(nearest / 100) * 100} 码`

    const losses = lossesAfterDeath(tl, victim.teamId, e.timestamp)

    const shutdown = e.shutdownBounty > 0 ? `｜送出终结赏金 ${e.shutdownBounty}` : ''
    out.push({
      kind: 'death',
      subjects: [e.victimId, e.killerId, ...e.assisting].filter(id => id > 0),
      minute: e.timestamp / 60000,
      weight: 1 + (losses.length > 0 ? 2 : 0) + (e.shutdownBounty > 0 ? 1 : 0),
      text:
        `${fmtTime(e.timestamp)} ${victim.champion}(${victim.name}) 死于${zoneOf(e.x, e.y, mapId)}` +
        `｜击杀：${killerText}｜伤害来源：${sourceText}｜${allyText}` +
        `｜之后 ${CONSEQUENCE_WINDOW_MS / 1000} 秒内己方丢失：${losses.join('、') || '无'}${shutdown}`
    })
  }
  return out
}
