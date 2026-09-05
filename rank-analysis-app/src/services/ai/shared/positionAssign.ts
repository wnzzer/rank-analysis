/**
 * 按队伍排除法的分路推断(召唤师峡谷 5v5 专用)
 *
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

export interface PositionAssignInput {
  championId: number
  spellIds: number[]
  /** 小兵补刀(totalMinionsKilled) */
  minionsKilled: number
  /** 野怪击杀(neutralMinionsKilled) */
  jungleMinionsKilled: number
}

/**
 * 给一支队伍的成员分配分路,返回与输入同序的位置数组。
 *
 * 仅在恰好 5 人时执行排除法(每个位置恰好一人);其他人数逐人回退
 * {@link inferTeamPosition}(可能产生 UNKNOWN/重复,消费方按原语义降级)。
 */
export function assignTeamPositions(players: PositionAssignInput[]): TeamPosition[] {
  if (players.length !== 5) {
    return players.map(p =>
      inferTeamPosition({ teamPosition: '', spellIds: p.spellIds, championId: p.championId })
    )
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
