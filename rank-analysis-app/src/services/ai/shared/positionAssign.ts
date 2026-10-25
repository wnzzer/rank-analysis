/**
 * 召唤师峡谷 5v5 的整队分路推断
 *
 * 首选槽位:选秀类队列(匹配征召/单双排/灵活)的 participantId 本身按槽位排好,
 * 每队依次为 上/野/中/下/辅。2026-10-25 真机 45 局单双排、450 人与 timeline
 * 前 10 分钟坐标逐一核对 448/450 一致(2 个不一致是游走辅助,槽位仍对);
 * 同批数据排除法只对 351/450——APC 下路(维克托配悠米)这类阵容会整队错位。
 * 槽位 2 必须是本队打野才采信,防队列数据不按槽位排时整队错位。
 *
 * 回退排除法(非选秀队列 / 缺 participantId / 槽位校验不过):
 * 国服 LCU 战绩整局缺 teamPosition,逐人启发式(positionInfer)对没带
 * 标志性技能的上单/非典型辅助推不出(真机实测一局 10 人错 4 个,且双辅助
 * 全 UNKNOWN → stage1「辅助伤害低不定罪」保护规则失效)。
 * 5v5 每队五个位置各恰好一人,可用强信号做排除法:
 * 吃野量定打野 → 补刀垫底定辅助 → ADC 职业/治疗屏障定下路 → 剩两人按
 * 法师中路/战士上路 + 传送分中上。整队信号互补,比逐人猜稳得多。
 */

import type { TeamPosition } from './types'
import {
  inferTeamPosition,
  ADC_CHAMPIONS,
  SUPPORT_CHAMPIONS,
  MAGE_CHAMPIONS,
  FIGHTER_CHAMPIONS,
  ASSASSIN_CHAMPIONS
} from './positionInfer'

const SPELL_SMITE = 11
const SPELL_TELEPORT = 12
const SPELL_HEAL = 7
const SPELL_BARRIER = 21

/**
 * participantId 按「上/野/中/下/辅」槽位排序的队列:匹配征召 400、单双排 420、
 * 灵活组排 440。盲选/快速等队列不分配位置,顺序无意义。
 */
const SLOT_ORDERED_QUEUES = new Set([400, 420, 440])
const SLOT_POSITIONS: TeamPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

export interface PositionAssignInput {
  championId: number
  spellIds: number[]
  /** 小兵补刀(totalMinionsKilled) */
  minionsKilled: number
  /** 野怪击杀(neutralMinionsKilled) */
  jungleMinionsKilled: number
  /** LCU participantId(1-10);提供且队列按槽位排序时优先按槽位取分路 */
  participantId?: number
}

/**
 * 按 participantId 槽位取分路;槽位不可信时返回 null。
 *
 * 可信条件:五人恰占同一队的五个连续槽(1-5 或 6-10),且槽位 2 是本队打野
 * (唯一带惩戒者;全队无惩戒时看吃野量最高者)。
 */
function assignBySlot(players: PositionAssignInput[]): TeamPosition[] | null {
  const pids = players.map(p => p.participantId ?? 0)
  const base = Math.min(...pids)
  if (base !== 1 && base !== 6) return null
  const slots = pids.map(id => id - base)
  if (new Set(slots).size !== 5 || slots.some(s => s > 4)) return null

  const smiters = players.filter(p => p.spellIds.includes(SPELL_SMITE))
  // 双惩戒说明阵容异常,槽位不足为凭
  if (smiters.length > 1) return null
  const jungler =
    smiters[0] ?? players.reduce((a, b) => (b.jungleMinionsKilled > a.jungleMinionsKilled ? b : a))
  if (jungler !== players[slots.indexOf(1)]) return null

  return slots.map(s => SLOT_POSITIONS[s])
}

/**
 * 给一支队伍的成员分配分路,返回与输入同序的位置数组。
 *
 * 仅在恰好 5 人时整队求解(每个位置恰好一人):选秀类队列且槽位可信时按
 * participantId 槽位,否则排除法;其他人数逐人回退 {@link inferTeamPosition}
 * (可能产生 UNKNOWN/重复,消费方按原语义降级)。
 * @param queueId - 对局队列;不传则只走排除法
 */
export function assignTeamPositions(
  players: PositionAssignInput[],
  queueId?: number
): TeamPosition[] {
  if (players.length !== 5) {
    return players.map(p =>
      inferTeamPosition({ teamPosition: '', spellIds: p.spellIds, championId: p.championId })
    )
  }

  if (queueId != null && SLOT_ORDERED_QUEUES.has(queueId)) {
    const bySlot = assignBySlot(players)
    if (bySlot) return bySlot
  }

  const result: TeamPosition[] = new Array(5).fill('UNKNOWN')
  const remaining = new Set([0, 1, 2, 3, 4])
  const has = (p: PositionAssignInput, spell: number): boolean => p.spellIds.includes(spell)

  /** 从 remaining 里取 score 最高者(平分时先比 tieBreak 降序,再取小下标) */
  const pick = (
    score: (p: PositionAssignInput) => number,
    tieBreak: (p: PositionAssignInput) => number = () => 0
  ): number => {
    let best = -1
    for (const i of remaining) {
      if (best < 0) {
        best = i
        continue
      }
      const d = score(players[i]) - score(players[best])
      if (d > 0 || (d === 0 && tieBreak(players[i]) > tieBreak(players[best]))) best = i
    }
    remaining.delete(best)
    return best
  }

  // 1. 打野:惩戒是决定性信号,吃野量兜底(带惩戒混线的怪异局也按惩戒算)
  const jungle = pick(p => (has(p, SPELL_SMITE) ? 100000 : 0) + p.jungleMinionsKilled)
  result[jungle] = 'JUNGLE'

  // 2. 辅助:剩余四人里补刀(含野怪)垫底者;平分时辅助职业优先
  const utility = pick(
    p => -(p.minionsKilled + p.jungleMinionsKilled),
    p => (SUPPORT_CHAMPIONS.has(p.championId) ? 1 : 0)
  )
  result[utility] = 'UTILITY'

  // 3. 下路:ADC 职业最强,治疗/屏障次之;平分比补刀(ADC 补刀通常不低)
  const bottom = pick(
    p =>
      (ADC_CHAMPIONS.has(p.championId) ? 4 : 0) +
      (has(p, SPELL_HEAL) || has(p, SPELL_BARRIER) ? 2 : 0),
    p => p.minionsKilled
  )
  result[bottom] = 'BOTTOM'

  // 4. 剩两人分上/中:战士倾向上路,法师/刺客倾向中路;传送作次级信号
  const top = pick(
    p =>
      (FIGHTER_CHAMPIONS.has(p.championId) ? 4 : 0) +
      (MAGE_CHAMPIONS.has(p.championId) || ASSASSIN_CHAMPIONS.has(p.championId) ? -4 : 0) +
      (has(p, SPELL_TELEPORT) ? 1 : 0)
  )
  result[top] = 'TOP'
  const middle = remaining.values().next().value as number
  result[middle] = 'MIDDLE'

  return result
}
