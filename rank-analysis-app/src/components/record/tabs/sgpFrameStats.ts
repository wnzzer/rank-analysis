/**
 * SGP DETAILS 帧流 → 详情透视表「SGP 帧流」行（纯函数，零副作用）。
 *
 * DETAILS 的 participants 只给 `{ participantId, puuid }`（无终局 stats），
 * 超细统计只能从帧流聚合（每分钟一条 `participantFrames[participantId]`）：
 * - 控制时间 `timeEnemySpentControlled`：各帧秒数累加（SGP 独有，LCU 无）；
 * - 终局属性 `championStats`：取**最后一次出现**的帧值（帧序即时间序）。
 *
 * 无该玩家任何帧 / 字段缺失 → NaN，走「—」兜底（与 detailsTable 口径一致）。
 */

import type { SgpGameDetail } from '@renderer/features/record/services/sgp'
import {
  fmtInt,
  fmtSpeed,
  fmtDuration,
  buildRowsFromSources,
  type StatRowDef,
  type StatsTablePlayer,
  type StatsTableRow
} from './detailsTable'

/** 行数据源：单玩家帧流聚合结果 */
export interface SgpFrameRowSource {
  /** 控制时间（秒，各帧累加） */
  controlTime: number
  /** 末帧攻击力 */
  attackDamage: number
  /** 末帧攻速 */
  attackSpeed: number
  /** 末帧护甲 */
  armor: number
  /** 末帧魔抗 */
  magicResist: number
  /** 末帧最大生命 */
  healthMax: number
  /** 末帧移速 */
  movementSpeed: number
  /** 末帧法强 */
  power: number
}

/** SGP 帧流行的展示分组（排在「其他」之后，仅 SGP 详情就绪时出现） */
export const SGP_FRAME_GROUP = 'SGP 帧流'

const MISSING_SOURCE: SgpFrameRowSource = {
  controlTime: NaN,
  attackDamage: NaN,
  attackSpeed: NaN,
  armor: NaN,
  magicResist: NaN,
  healthMax: NaN,
  movementSpeed: NaN,
  power: NaN
}

function startSource(): SgpFrameRowSource {
  return { ...MISSING_SOURCE, controlTime: 0 }
}

export const SGP_FRAME_ROWS: StatRowDef<SgpFrameRowSource>[] = [
  {
    key: 'controlTime',
    label: '控制时间',
    group: SGP_FRAME_GROUP,
    value: s => s.controlTime,
    format: fmtDuration
  },
  {
    key: 'attackDamage',
    label: '攻击力',
    group: SGP_FRAME_GROUP,
    value: s => s.attackDamage,
    format: fmtInt
  },
  {
    key: 'attackSpeed',
    label: '攻速',
    group: SGP_FRAME_GROUP,
    value: s => s.attackSpeed,
    format: fmtSpeed
  },
  {
    key: 'power',
    label: '法强',
    group: SGP_FRAME_GROUP,
    value: s => s.power,
    format: fmtInt
  },
  {
    key: 'healthMax',
    label: '最大生命',
    group: SGP_FRAME_GROUP,
    value: s => s.healthMax,
    format: fmtInt
  },
  {
    key: 'movementSpeed',
    label: '移速',
    group: SGP_FRAME_GROUP,
    value: s => s.movementSpeed,
    format: fmtInt
  },
  {
    key: 'armor',
    label: '护甲',
    group: SGP_FRAME_GROUP,
    value: s => s.armor,
    format: fmtInt
  },
  {
    key: 'magicResist',
    label: '魔抗',
    group: SGP_FRAME_GROUP,
    value: s => s.magicResist,
    format: fmtInt
  }
]

/**
 * 聚合 SGP DETAILS 帧流：participantId → 行数据源。
 *
 * 语义：`controlTime` 各帧累加；`championStats` 逐帧覆盖（末帧生效）；
 * 帧里从未出现的玩家不在 Map 中（消费方按 NaN 处理）。
 *
 * @param detail - SGP 详情（null/undefined → 空 Map）
 * @returns participantId → 聚合结果
 */
export function aggregateSgpFrameStats(
  detail: SgpGameDetail | null | undefined
): Map<number, SgpFrameRowSource> {
  const out = new Map<number, SgpFrameRowSource>()
  if (!detail) return out
  for (const frame of detail.frames) {
    if (!frame.participantFrames) continue
    for (const [pid, ps] of Object.entries(frame.participantFrames)) {
      const id = Number(pid)
      if (!Number.isFinite(id)) continue
      const cur = out.get(id) ?? startSource()
      if (ps.timeEnemySpentControlled != null) {
        cur.controlTime += ps.timeEnemySpentControlled
      }
      const cs = ps.championStats
      if (cs) {
        if (cs.attackDamage != null) cur.attackDamage = cs.attackDamage
        if (cs.attackSpeed != null) cur.attackSpeed = cs.attackSpeed
        if (cs.armor != null) cur.armor = cs.armor
        if (cs.magicResist != null) cur.magicResist = cs.magicResist
        if (cs.healthMax != null) cur.healthMax = cs.healthMax
        if (cs.movementSpeed != null) cur.movementSpeed = cs.movementSpeed
        if (cs.power != null) cur.power = cs.power
      }
      out.set(id, cur)
    }
  }
  return out
}

/**
 * 装配「SGP 帧流」透视表行：行定义 × 10 人玩家（按 participantId 对齐聚合源）。
 *
 * @param players - 已排序（蓝→红）的 10 人玩家（列序）
 * @param aggs - aggregateSgpFrameStats 的结果；帧里缺失的玩家列值全 NaN
 * @returns 行数组（与 buildStatsTable 输出同构，可直接并入总表）
 */
export function buildSgpFrameRows(
  players: StatsTablePlayer[],
  aggs: ReadonlyMap<number, SgpFrameRowSource>
): StatsTableRow[] {
  return buildRowsFromSources(
    SGP_FRAME_ROWS,
    players.map(p => aggs.get(p.participantId) ?? MISSING_SOURCE)
  )
}
