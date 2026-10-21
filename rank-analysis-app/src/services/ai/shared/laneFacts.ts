/**
 * 对位 / 位置职责的确定性事实（TS 算好，模型直接消费）。
 *
 * 与 recentProfile 的 isOffRole 同一思路：模型自己找对位、自己做减法时经常算错
 * （评测里 qwen-flash 把盲僧 4/6/8 写成 2/8），也常拿「辅助伤害低」「打野补刀低」
 * 当罪状。把差值与「相对本位置常见区间的高低」预先算好写进快照，
 * prompt 只要求照抄，不再让模型推断。
 */

import type { TeamPosition } from './types'

/** 判定所需的玩家字段（snapshot.players 的子集） */
export interface LaneFactPlayer {
  participantId: number
  teamId: number
  name: string
  champion: string
  teamPosition: TeamPosition
  kills: number
  deaths: number
  kda: number
  gold: number
  cs: number
  damageShare: number
  goldShare: number
  killParticipation: number
  damageTakenShare: number
  csm: number
}

/** 本人 − 同分路敌方对位的差值（正数 = 本人领先） */
export interface VsLaneOpponent {
  opponentName: string
  opponentChampion: string
  goldDiff: number
  csDiff: number
  kdaDiff: number
  killsDiff: number
  deathsDiff: number
  damageShareDiff: number
}

export type BenchmarkLevel = 'high' | 'normal' | 'low'

/** 相对本位置常见区间的高低 */
export type RoleBenchmark = Record<BenchmarkMetric, BenchmarkLevel>

type BenchmarkMetric =
  'damageShare' | 'goldShare' | 'killParticipation' | 'damageTakenShare' | 'csm'

type LanePosition = Exclude<TeamPosition, 'UNKNOWN'>

/**
 * 各位置的常见区间 [下沿, 上沿]（单双排 / 灵活排中位段位的经验区间，非精确统计）。
 * 落在区间内 = normal，低于下沿 = low，高于上沿 = high。区间刻意放宽：
 * 只想拦住「辅助伤害 8% 被当成罪状」这类常识错误，不做细粒度打分。
 */
export const ROLE_BENCHMARKS: Record<LanePosition, Record<BenchmarkMetric, [number, number]>> = {
  TOP: {
    damageShare: [18, 30],
    goldShare: [19, 25],
    killParticipation: [35, 65],
    damageTakenShare: [20, 34],
    csm: [6, 9]
  },
  JUNGLE: {
    damageShare: [13, 24],
    goldShare: [17, 23],
    killParticipation: [50, 80],
    damageTakenShare: [18, 32],
    csm: [4.3, 6.8]
  },
  MIDDLE: {
    damageShare: [22, 34],
    goldShare: [19, 25],
    killParticipation: [45, 75],
    damageTakenShare: [12, 24],
    csm: [6.5, 9.5]
  },
  BOTTOM: {
    damageShare: [22, 34],
    goldShare: [22, 28],
    killParticipation: [45, 75],
    damageTakenShare: [10, 22],
    csm: [7, 10]
  },
  UTILITY: {
    damageShare: [5, 15],
    goldShare: [10, 16],
    killParticipation: [55, 85],
    damageTakenShare: [12, 26],
    csm: [0, 2.5]
  }
}

const LANE_POSITIONS = new Set<string>(Object.keys(ROLE_BENCHMARKS))

const round = (v: number, digits: number) => Number(v.toFixed(digits))

function level(value: number, [lo, hi]: [number, number]): BenchmarkLevel {
  if (value < lo) return 'low'
  if (value > hi) return 'high'
  return 'normal'
}

/**
 * 找同分路敌方对位并算差值
 * @param player - 目标玩家
 * @param players - 本局全部玩家
 * @returns 无分路 / 对面缺同位玩家时为 null
 */
export function computeVsLaneOpponent(
  player: LaneFactPlayer,
  players: LaneFactPlayer[]
): VsLaneOpponent | null {
  if (!LANE_POSITIONS.has(player.teamPosition)) return null
  const opp = players.find(
    p => p.teamId !== player.teamId && p.teamPosition === player.teamPosition
  )
  if (!opp) return null
  return {
    opponentName: opp.name,
    opponentChampion: opp.champion,
    goldDiff: player.gold - opp.gold,
    csDiff: player.cs - opp.cs,
    kdaDiff: round(player.kda - opp.kda, 2),
    killsDiff: player.kills - opp.kills,
    deathsDiff: player.deaths - opp.deaths,
    damageShareDiff: round(player.damageShare - opp.damageShare, 1)
  }
}

/**
 * 相对本位置常见区间的高低
 * @param player - 目标玩家
 * @returns 无分路（大乱斗等）/ 分路未知时为 null
 */
export function computeRoleBenchmark(player: LaneFactPlayer): RoleBenchmark | null {
  if (!LANE_POSITIONS.has(player.teamPosition)) return null
  const ranges = ROLE_BENCHMARKS[player.teamPosition as LanePosition]
  return {
    damageShare: level(player.damageShare, ranges.damageShare),
    goldShare: level(player.goldShare, ranges.goldShare),
    killParticipation: level(player.killParticipation, ranges.killParticipation),
    damageTakenShare: level(player.damageTakenShare, ranges.damageTakenShare),
    csm: level(player.csm, ranges.csm)
  }
}
