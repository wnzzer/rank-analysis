/**
 * 死亡归责（spec §2）：每次英雄阵亡判一个类型和本人责任系数。
 *
 * 优先级自上而下取第一类：单杀 → 被抓 → 孤立阵亡 → 团战阵亡（队友未先崩）→ 队友先崩 → 其他。
 * 「其他」是 spec 表外的兜底类，表示五类都不满足，按无时间线的保守值 0.8 计。
 * 「被抓」只在对线期（< 14 分钟）判：过了对线期，人员轮转后「本人分路区域」已经没有意义。
 *
 * 类型定下后再做两步修正（2026-11-09）：
 * 1. 以少打多：被抓 / 孤立 / 其他三类按参与击杀的敌方人数衰减本人责任（3 包 1 起），
 *    否则后期边路被 4 包 1 会落进「孤立」吃满全责，和被对位单杀同罪。
 * 2. 搭档缺位：职责表（LANE_PARTNER_DUTIES）里「该在身边」的搭档不在时，分走一份责任，
 *    死者相应减责。目前只配了对线期辅助 → 下路：保护 AD 是辅助的本职，
 *    中野游走抓人是本职、不在此列。
 *
 * 后果再做一步修正（2026-11-09，第 3 层）：牵制换资源。被 ≥3 人包抄的阵亡，若死后 60 秒内
 * 己方在别处拿了资源/建筑，说明死者拖住了多人、队伍换到了东西；后果按「丢的 − 换到的」净值算
 * （不低于 0），否则被包后丢塔会在后果里再放大一次，和以少打多减责互相抵消。
 */
import { gainsAfterDeath, lossesAfterDeath, nearestAllyDistance } from '../timeline/cards/death'
import { clusterFights } from '../timeline/cards/fight'
import { dist, positionAt } from '../timeline/geometry'
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
 * 以少打多的本人责任系数，下标 = 参与击杀的敌方英雄数（击杀者 + 助攻）。
 * 1~2 人不衰减（2 人是普通 gank，「被抓」0.5 已经折算过）；超出表长取最后一项。
 * 不降到 0：被包也有站位、视野、带线时机的问题。
 */
export const OUTNUMBERED_FACTOR = [1, 1, 1, 0.75, 0.6, 0.5]
/** 参与衰减的阵亡类型：团战 / 队友先崩本身就是多打多，人数说明不了谁吃亏 */
const OUTNUMBER_KINDS: ReadonlySet<DeathKind> = new Set<DeathKind>(['ganked', 'isolated', 'other'])

/**
 * 搭档职责：对线期 `ward` 位置阵亡时，`guardian` 位置的队友不在身边就分担一份责任。
 * @property minEnemies - 至少几名敌人参与击杀才追责（对面单杀不该怪搭档）
 * @property share - 搭档分走的责任
 * @property relief - 死者本人责任的折算系数
 */
interface PartnerDuty {
  guardian: string
  ward: string
  minEnemies: number
  share: number
  relief: number
}

/** 职责表：只放「保护对方是本职」的组合；中野游走是本职，不进表 */
export const LANE_PARTNER_DUTIES: readonly PartnerDuty[] = [
  { guardian: 'UTILITY', ward: 'BOTTOM', minEnemies: 2, share: 0.3, relief: 0.7 }
]
/** 搭档离阵亡地点超过此距离（码，帧插值约值）算不在身边；比孤立阈值宽，帧位置误差大 */
export const PARTNER_ABSENT_DISTANCE = 3000

/**
 * 按位置的本人阵亡责任系数（2026-11-09 用户要求：辅助阵亡减责）。
 * 辅助的本职就是排眼、开团、替后排挡技能，阵亡多是职责代价；被对位单杀仍算自身问题，不打折。
 * 只折算本人阵亡、不折算缺位分担——基准按位置标准化，统一缩放会被抵消，
 * 差异化后辅助分数里「自己死」的比重下降、「不在 AD 身边」的比重相对上升。
 */
export const ROLE_DEATH_FACTOR: Readonly<Record<string, number>> = { UTILITY: 0.8 }

/** 牵制换资源：至少几名敌人参与击杀才算「拖住了多人」（与以少打多衰减起点一致） */
export const TRADE_MIN_ENEMIES = 3

/**
 * 单次阵亡的归责结果
 * @property responsibility - 死者本人责任（已含以少打多与搭档缺位的修正）
 * @property enemies - 参与击杀的敌方英雄数（击杀者 + 助攻；塔/小兵终结时只算助攻）
 * @property absentPartner - 该在身边却不在的搭档及其分担的责任；无则缺省
 * @property consequence - 后果 = 1 + 死后 60 秒己方丢失资源/建筑数 + 送出终结赏金/300；
 *   牵制换资源时丢失数改为「丢失 − 换到」的净值（不低于 0）
 * @property traded - 被 ≥3 人包抄且死后 60 秒内己方换到了资源/建筑；未换到则缺省
 */
export interface AttributedDeath {
  victimId: number
  timestamp: number
  kind: DeathKind
  responsibility: number
  enemies: number
  absentPartner?: { participantId: number; share: number }
  consequence: number
  traded?: boolean
}

/**
 * 某玩家为一次阵亡承担的责任：死者本人，或缺位的搭档。
 * 死亡质量与对线期阵亡责任都按它汇总，让缺位搭档和死者一样为后果买单。
 */
export function blameOf(d: AttributedDeath, participantId: number): number {
  if (d.victimId === participantId) return d.responsibility
  if (d.absentPartner?.participantId === participantId) return d.absentPartner.share
  return 0
}

type Kill = Extract<SlimEvent, { type: 'CHAMPION_KILL' }>

/** 两位小数，避免 0.5 × 0.75 × 0.7 这类乘积在测试与喂模型时带一长串浮点尾巴 */
const round2 = (v: number): number => Math.round(v * 100) / 100

/** 下路与辅助同属一条线 */
const laneGroup = (pos: string): string => (pos === 'BOTTOM' || pos === 'UTILITY' ? 'BOT' : pos)

/** 某地点是否在该玩家的分路区域（打野 = 己方野区）；死亡归责与游走指标共用 */
export function inOwnLaneArea(victim: RosterPlayer, x: number, y: number, mapId: number): boolean {
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

  /** 参与击杀的敌方英雄数（去重；killerId 0 = 塔/小兵，不算人） */
  const enemyCount = (e: Kill, victim: RosterPlayer): number =>
    new Set(
      [e.killerId, ...e.assisting].filter(id => {
        const r = byId.get(id)
        return !!r && r.teamId !== victim.teamId
      })
    ).size

  /** 职责表命中且搭档不在身边时，返回该搭档 */
  const absentGuardian = (
    e: Kill,
    victim: RosterPlayer,
    enemies: number
  ): { duty: PartnerDuty; guardian: RosterPlayer } | null => {
    if (!hasLanes || e.timestamp >= LANE_PHASE_MS || !inOwnLaneArea(victim, e.x, e.y, mapId))
      return null
    for (const duty of LANE_PARTNER_DUTIES) {
      if (victim.teamPosition !== duty.ward || enemies < duty.minEnemies) continue
      const guardian = roster.find(
        r => r.teamId === victim.teamId && r.teamPosition === duty.guardian
      )
      if (!guardian) continue
      // 搭档刚在 30 秒内先倒下是一起打输了，不是游走缺位（插值位置会落回泉水，误判成「不在」）
      const guardianJustDied = kills.some(
        k =>
          k.victimId === guardian.participantId &&
          k.timestamp <= e.timestamp &&
          k.timestamp >= e.timestamp - COLLAPSE_WINDOW_MS
      )
      if (guardianJustDied) continue
      const p = positionAt(tl, guardian.participantId, e.timestamp)
      if (p && dist(p.x, p.y, e.x, e.y) > PARTNER_ABSENT_DISTANCE) return { duty, guardian }
    }
    return null
  }

  const out: AttributedDeath[] = []
  for (const e of kills) {
    const victim = byId.get(e.victimId)
    if (!victim) continue
    const kind = classify(e, victim)
    const enemies = enemyCount(e, victim)
    let responsibility = RESPONSIBILITY[kind]
    if (OUTNUMBER_KINDS.has(kind)) {
      responsibility *= OUTNUMBERED_FACTOR[Math.min(enemies, OUTNUMBERED_FACTOR.length - 1)]
    }
    const absent = absentGuardian(e, victim, enemies)
    if (absent) responsibility *= absent.duty.relief
    if (hasLanes && kind !== 'solo') responsibility *= ROLE_DEATH_FACTOR[victim.teamPosition] ?? 1
    const losses = lossesAfterDeath(tl, victim.teamId, e.timestamp).length
    const gains = enemies >= TRADE_MIN_ENEMIES ? gainsAfterDeath(tl, victim.teamId, e.timestamp) : 0
    const traded = gains > 0
    out.push({
      victimId: e.victimId,
      timestamp: e.timestamp,
      kind,
      responsibility: round2(responsibility),
      enemies,
      ...(absent
        ? {
            absentPartner: {
              participantId: absent.guardian.participantId,
              share: absent.duty.share
            }
          }
        : {}),
      consequence: 1 + Math.max(0, losses - gains) + e.shutdownBounty / SHUTDOWN_UNIT,
      ...(traded ? { traded: true } : {})
    })
  }
  return out
}
