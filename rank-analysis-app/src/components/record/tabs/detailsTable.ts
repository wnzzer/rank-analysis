/**
 * 数据对比透视表的统计行定义与装配（纯函数，零副作用）
 *
 * 行 = 一条统计（击杀/伤害/金钱…），列 = 10 名玩家。
 * 数据源：`ParticipantStats`（LCU game_detail.participants 已含的字段），
 * 全部前端装配，无后端改动。SGP 增强字段（视野/超细统计）后续在此追加行配置，
 * 未识别/缺失字段走兜底显示「—」，不会崩 UI。
 */

import type { ParticipantStats } from '@renderer/types/domain/match'

export type StatGroup = '基础' | '击杀' | '伤害' | '经济' | '参团' | '其他'

export interface StatRowDef {
  /** 唯一标识（用于过滤匹配与测试断言） */
  key: string
  /** 中文名（过滤/表头展示） */
  label: string
  group: StatGroup
  /** 从玩家 stats 取原始值；可选字段缺失时返回 NaN 以走「—」兜底 */
  value: (stats: ParticipantStats) => number
  /** 展示格式 */
  format: (value: number) => string
}

export const STAT_GROUPS: StatGroup[] = ['基础', '击杀', '伤害', '经济', '参团', '其他']

const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US')
const fmtPct = (v: number) => `${Math.round(v)}%`
const fmtKda = (v: number) => v.toFixed(1)

/** 统计行定义表：顺序即展示顺序（按组连续排列） */
export const STAT_ROWS: StatRowDef[] = [
  // 基础
  { key: 'kills', label: '击杀', group: '基础', value: s => s.kills, format: fmtInt },
  { key: 'deaths', label: '死亡', group: '基础', value: s => s.deaths, format: fmtInt },
  { key: 'assists', label: '助攻', group: '基础', value: s => s.assists, format: fmtInt },
  {
    key: 'kda',
    label: 'KDA',
    group: '基础',
    value: s => (s.kills + s.assists) / Math.max(1, s.deaths),
    format: fmtKda
  },
  { key: 'groupRate', label: '参团率', group: '基础', value: s => s.groupRate, format: fmtPct },
  // 击杀
  {
    key: 'doubleKills',
    label: '双杀',
    group: '击杀',
    value: s => s.doubleKills ?? NaN,
    format: fmtInt
  },
  {
    key: 'tripleKills',
    label: '三杀',
    group: '击杀',
    value: s => s.tripleKills ?? NaN,
    format: fmtInt
  },
  {
    key: 'quadraKills',
    label: '四杀',
    group: '击杀',
    value: s => s.quadraKills ?? NaN,
    format: fmtInt
  },
  {
    key: 'pentaKills',
    label: '五杀',
    group: '击杀',
    value: s => s.pentaKills ?? NaN,
    format: fmtInt
  },
  // 伤害
  {
    key: 'totalDamageDealtToChampions',
    label: '对英雄伤害',
    group: '伤害',
    value: s => s.totalDamageDealtToChampions,
    format: fmtInt
  },
  {
    key: 'totalDamageDealt',
    label: '总伤害',
    group: '伤害',
    value: s => s.totalDamageDealt,
    format: fmtInt
  },
  {
    key: 'totalDamageTaken',
    label: '承受伤害',
    group: '伤害',
    value: s => s.totalDamageTaken,
    format: fmtInt
  },
  { key: 'totalHeal', label: '治疗', group: '伤害', value: s => s.totalHeal, format: fmtInt },
  {
    key: 'damageDealtToTurrets',
    label: '推塔伤害',
    group: '伤害',
    value: s => s.damageDealtToTurrets,
    format: fmtInt
  },
  {
    key: 'damageDealtToChampionsRate',
    label: '伤害占比',
    group: '伤害',
    value: s => s.damageDealtToChampionsRate,
    format: fmtPct
  },
  {
    key: 'damageTakenRate',
    label: '承伤占比',
    group: '伤害',
    value: s => s.damageTakenRate,
    format: fmtPct
  },
  // 经济
  { key: 'goldEarned', label: '获得金钱', group: '经济', value: s => s.goldEarned, format: fmtInt },
  { key: 'goldSpent', label: '花费金钱', group: '经济', value: s => s.goldSpent, format: fmtInt },
  {
    key: 'goldEarnedRate',
    label: '经济占比',
    group: '经济',
    value: s => s.goldEarnedRate,
    format: fmtPct
  },
  {
    key: 'cs',
    label: '补刀',
    group: '经济',
    value: s => s.totalMinionsKilled + s.neutralMinionsKilled,
    format: fmtInt
  },
  { key: 'healRate', label: '治疗占比', group: '经济', value: s => s.healRate, format: fmtPct },
  // 其他（SGP 增强前的兜底组：LCU 无字段的行统一在此标注）
  {
    key: 'visionScore',
    label: '视野得分（SGP 增强）',
    group: '其他',
    value: () => NaN,
    format: fmtInt
  }
]

export interface StatsTableRow {
  def: StatRowDef
  /** 与列对齐的 10 人原始值（NaN = 缺失） */
  values: number[]
  /** 全场最大值（NaN 过滤后），用于 hover 条形图刻度；全缺失时为 0 */
  max: number
}

export interface StatsTablePlayer {
  /** 透视表列序：先蓝队后红队（按 teamId 升序） */
  index: number
  participantId: number
  teamId: number
  displayName: string
  championId: number
  win: boolean
  /** 原始统计（行定义取值来源） */
  stats: ParticipantStats
}

/**
 * 装配透视表数据：行定义 × 10 人玩家 → 每行的 10 个值 + 刻度最大值
 * @param rows - 行定义（默认 STAT_ROWS）
 * @param players - 已排序（蓝→红）的 10 人玩家
 * @returns 按组连续排列的行数组
 */
export function buildStatsTable(
  players: StatsTablePlayer[],
  rows: StatRowDef[] = STAT_ROWS
): StatsTableRow[] {
  return rows.map(def => {
    const values = players.map(p => def.value(p.stats))
    const numeric = values.filter(v => Number.isFinite(v))
    const max = numeric.length ? Math.max(...numeric) : 0
    return { def, values, max }
  })
}

/**
 * 行过滤（LCU 版简化：仅名称匹配）
 * @param rows - buildStatsTable 的结果
 * @param keyword - 过滤词（label/key 包含匹配，忽略大小写；空串不过滤）
 */
export function filterStatsRows(rows: StatsTableRow[], keyword: string): StatsTableRow[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return rows
  return rows.filter(
    row => row.def.label.toLowerCase().includes(kw) || row.def.key.toLowerCase().includes(kw)
  )
}
