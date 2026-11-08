/**
 * 死亡归责（spec §2）：每次英雄阵亡判一个类型和本人责任系数。
 *
 * 优先级自上而下取第一类：单杀 → 被抓 → 孤立阵亡 → 团战阵亡（队友未先崩）→ 队友先崩 → 其他。
 * 「其他」是 spec 表外的兜底类，表示五类都不满足，按无时间线的保守值 0.8 计。
 * 「被抓」只在对线期（< 14 分钟）判：过了对线期，人员轮转后「本人分路区域」已经没有意义。
 */
import { lossesAfterDeath, nearestAllyDistance } from '../timeline/cards/death'
import { clusterFights } from '../timeline/cards/fight'
import { laneOpponent } from '../timeline/cards/lane'
import { sideLabel, zoneOf } from '../timeline/labels'
import type { CardInput, RosterPlayer, SlimEvent } from '../timeline/types'

/** 阵亡类型 */
export type DeathKind = 'solo' | 'isolated' | 'ganked' | 'fight' | 'collapse' | 'other'

/** 本人责任系数（spec §2 表；other 为兜底） */
export const RESPONSIBILITY: Record<DeathKind, number> = {
  solo: 1,
  isolated: 1,
  ganked: 0.5,
  fight: 0.6,
  collapse: 0.3,
  other: 0.8
}

/** 无时间线时每次阵亡的保守责任 */
export const NO_TIMELINE_RESPONSIBILITY = 0.8

/** 类型中文名（喂模型的死亡归责明细用） */
export const DEATH_KIND_CN: Record<DeathKind, string> = {
  solo: '单杀',
  isolated: '孤立阵亡',
  ganked: '被抓',
  fight: '团战阵亡',
  collapse: '队友先崩',
  other: '其他阵亡'
}

/** 对线期上限（毫秒） */
export const LANE_PHASE_MS = 14 * 60000
/** 孤立：最近队友距离阈值（码） */
const ISOLATED_DISTANCE = 2000
/** 队友先崩：统计窗口与人数 */
const COLLAPSE_WINDOW_MS = 30000
const COLLAPSE_MIN_TEAMMATES = 2
/** 队友先崩：只计死在本人阵亡地点此距离（码）内的队友 */
const COLLAPSE_DISTANCE = 3000
/** 终结赏金折算为「资源」的单位 */
const SHUTDOWN_UNIT = 300
/** 会游走抓人的位置（spec：对面打野/中单/辅助参与） */
const ROAMERS = new Set(['JUNGLE', 'MIDDLE', 'UTILITY'])

/**
 * 单次阵亡的归责结果
 * @property consequence - 后果 = 1 + 死后 60 秒己方丢失资源/建筑数 + 送出终结赏金/300
 */
export interface AttributedDeath {
  victimId: number
  timestamp: number
  kind: DeathKind
  responsibility: number
  consequence: number
}

type Kill = Extract<SlimEvent, { type: 'CHAMPION_KILL' }>

/** 下路与辅助同属一条线 */
const laneGroup = (pos: string): string => (pos === 'BOTTOM' || pos === 'UTILITY' ? 'BOT' : pos)

/** 阵亡地点是否在本人分路区域（打野 = 己方野区） */
function inOwnLaneArea(victim: RosterPlayer, x: number, y: number, mapId: number): boolean {
  const zone = zoneOf(x, y, mapId)
  switch (victim.teamPosition) {
    case 'TOP':
      return zone.startsWith('上路')
    case 'MIDDLE':
      return zone.startsWith('中路')
    case 'BOTTOM':
    case 'UTILITY':
      return zone.startsWith('下路')
    case 'JUNGLE':
      return zone.startsWith(sideLabel(victim.teamId)) && zone.endsWith('野区')
    default:
      return false
  }
}

/** 阵亡前 30 秒内（含同一时刻）、死在 (x, y) 附近 3000 码内的不同队友数 */
function teammatesDown(
  kills: Kill[],
  victim: RosterPlayer,
  team: Map<number, number>,
  ms: number,
  x: number,
  y: number
) {
  const down = new Set<number>()
  for (const k of kills) {
    if (k.victimId === victim.participantId || team.get(k.victimId) !== victim.teamId) continue
    if (k.timestamp < ms - COLLAPSE_WINDOW_MS || k.timestamp > ms) continue
    if (Math.hypot(k.x - x, k.y - y) <= COLLAPSE_DISTANCE) down.add(k.victimId)
  }
  return down.size
}

/**
 * 为时间线里每次（名册内玩家的）阵亡归责。
 * @param input - 卡片提取器同款输入（participantId 已 remap 为 LCU 编号）
 * @returns 按事件时间顺序
 */
export function attributeDeaths(input: CardInput): AttributedDeath[] {
  const { tl, roster, hasLanes, mapId } = input
  const byId = new Map(roster.map(r => [r.participantId, r]))
  const team = new Map(roster.map(r => [r.participantId, r.teamId]))
  const kills = tl.events.filter((e): e is Kill => e.type === 'CHAMPION_KILL')
  const inFight = new Set<Kill>(clusterFights(input).flatMap(f => f.kills))

  const classify = (e: Kill, victim: RosterPlayer): DeathKind => {
    const opp = hasLanes ? laneOpponent(roster, victim.participantId) : undefined
    if (opp && e.killerId === opp.participantId && e.assisting.length === 0) return 'solo'
    if (hasLanes && e.timestamp < LANE_PHASE_MS && inOwnLaneArea(victim, e.x, e.y, mapId)) {
      const ganker = [e.killerId, ...e.assisting].some(id => {
        const r = byId.get(id)
        return (
          !!r &&
          r.teamId !== victim.teamId &&
          ROAMERS.has(r.teamPosition) &&
          laneGroup(r.teamPosition) !== laneGroup(victim.teamPosition)
        )
      })
      if (ganker) return 'ganked'
    }
    const nearest = nearestAllyDistance(tl, roster, victim, e.x, e.y, e.timestamp)
    if (nearest !== null && nearest > ISOLATED_DISTANCE) return 'isolated'
    const collapsed =
      teammatesDown(kills, victim, team, e.timestamp, e.x, e.y) >= COLLAPSE_MIN_TEAMMATES
    if (inFight.has(e) && !collapsed) return 'fight'
    if (collapsed) return 'collapse'
    return 'other'
  }

  const out: AttributedDeath[] = []
  for (const e of kills) {
    const victim = byId.get(e.victimId)
    if (!victim) continue
    const kind = classify(e, victim)
    out.push({
      victimId: e.victimId,
      timestamp: e.timestamp,
      kind,
      responsibility: RESPONSIBILITY[kind],
      consequence:
        1 +
        lossesAfterDeath(tl, victim.teamId, e.timestamp).length +
        e.shutdownBounty / SHUTDOWN_UNIT
    })
  }
  return out
}
