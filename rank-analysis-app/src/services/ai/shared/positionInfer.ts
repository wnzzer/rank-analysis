/**
 * 路位推断兜底。LCU 返回的 teamPosition 有时为空或 NONE，
 * 此时用召唤师技能 + 英雄 ID 推断。
 */

import type { TeamPosition } from './types'

// 粗粒度英雄分类。仅覆盖常见英雄，未列出的归类为 unknown。
const ADC_CHAMPIONS = new Set([
  22, 51, 222, 119, 21, 42, 67, 81, 110, 145, 202, 236, 360, 429, 498, 18, 15, 96, 203, 523, 221,
  200, 532
])
const SUPPORT_CHAMPIONS = new Set([
  117, 412, 25, 16, 37, 40, 43, 53, 89, 99, 111, 143, 201, 235, 267, 350, 432, 497, 555, 526, 901,
  223, 161
])
const MAGE_CHAMPIONS = new Set([
  1, 8, 13, 17, 30, 34, 45, 50, 61, 63, 69, 74, 90, 101, 112, 115, 134, 142, 163, 268, 300, 99, 4,
  26, 27, 36, 950, 84
])
const FIGHTER_CHAMPIONS = new Set([
  2, 23, 24, 39, 41, 48, 54, 57, 58, 62, 75, 77, 78, 80, 82, 83, 86, 92, 98, 102, 106, 113, 114,
  122, 126, 150, 154, 157, 164, 240, 254, 266, 421, 516, 517, 875, 887, 888
])
const ASSASSIN_CHAMPIONS = new Set([
  7, 28, 38, 55, 56, 60, 91, 103, 121, 131, 141, 238, 245, 246, 105, 35
])

const SPELL_SMITE = 11
const SPELL_TELEPORT = 12
const SPELL_HEAL = 7
const SPELL_BARRIER = 21
const SPELL_EXHAUST = 3
const SPELL_IGNITE = 14

export interface PositionInferInput {
  teamPosition: string
  spellIds: number[]
  championId: number
}

export function inferTeamPosition(input: PositionInferInput): TeamPosition {
  const { teamPosition, spellIds, championId } = input

  // Passthrough if LCU gave a real position
  if (
    teamPosition === 'TOP' ||
    teamPosition === 'JUNGLE' ||
    teamPosition === 'MIDDLE' ||
    teamPosition === 'BOTTOM' ||
    teamPosition === 'UTILITY'
  ) {
    return teamPosition
  }

  const spells = new Set(spellIds)

  // Jungle: Smite is the strongest signal
  if (spells.has(SPELL_SMITE)) return 'JUNGLE'

  // Teleport: TOP for fighter, MIDDLE for mage/assassin
  if (spells.has(SPELL_TELEPORT)) {
    if (FIGHTER_CHAMPIONS.has(championId)) return 'TOP'
    if (MAGE_CHAMPIONS.has(championId) || ASSASSIN_CHAMPIONS.has(championId)) return 'MIDDLE'
  }

  // Heal / Barrier: BOTTOM for ADC, UTILITY for support
  if (spells.has(SPELL_HEAL) || spells.has(SPELL_BARRIER)) {
    if (ADC_CHAMPIONS.has(championId)) return 'BOTTOM'
    if (SUPPORT_CHAMPIONS.has(championId)) return 'UTILITY'
  }

  // Exhaust + support → UTILITY
  if (spells.has(SPELL_EXHAUST) && SUPPORT_CHAMPIONS.has(championId)) {
    return 'UTILITY'
  }

  // Ignite + mage/assassin → MIDDLE
  if (spells.has(SPELL_IGNITE)) {
    if (MAGE_CHAMPIONS.has(championId) || ASSASSIN_CHAMPIONS.has(championId)) {
      return 'MIDDLE'
    }
  }

  // 技能全无信号时按职业分布兜底：ADC/辅助英雄的分路集中度极高
  // （国服真机实测 MF 带闪现+疾行，治疗/屏障规则接不住）。
  // 战士刻意不兜底——中单剑豪这类误判上单的代价大于收益。
  if (ADC_CHAMPIONS.has(championId)) return 'BOTTOM'
  if (SUPPORT_CHAMPIONS.has(championId)) return 'UTILITY'

  return 'UNKNOWN'
}
