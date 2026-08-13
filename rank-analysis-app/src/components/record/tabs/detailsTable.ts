/**
 * 数据对比透视表的统计行定义与装配（纯函数，零副作用）
 *
 * 行 = 一条统计（击杀/伤害/金钱…），列 = 10 名玩家。
 * 数据源：`ParticipantStats`（LCU game_detail.participants 已含的字段），
 * 全部前端装配，无后端改动。SGP 增强字段（视野/超细统计）后续在此追加行配置，
 * 未识别/缺失字段走兜底显示「—」，不会崩 UI。
 *
 * C-3-UI：额外提供「出装对比行」——每人 7 件 vs 该英雄推荐 7 件，
 * 逐槽位/整体差异判定（纯函数 {@link diffBuild}，与 PUGG 推荐解耦，仅吃
 * 玩家装备 id 数组 + 推荐 id 数组），展示层在 MatchDetailStatsTab.vue。
 */

import type { ParticipantStats } from '@renderer/types/domain/match'
import type { ItemStat } from '@renderer/services/builds'

export type StatGroup = '基础' | '击杀' | '伤害' | '经济' | '参团' | '其他'

/** 饰品装备 id 集合（与后端 pugg/aggregate.rs 的 WARD_ITEMS 同源） */
export const WARD_ITEM_IDS: ReadonlySet<number> = new Set([3330, 3340, 3341, 3363, 3364, 3513])

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
  /** 召唤师技能（出装对比行悬停详情用） */
  spell1Id: number
  spell2Id: number
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

// ── C-3-UI 出装对比行 ──────────────────────────────────────────────

/** 单槽位对比状态 */
export type BuildSlotState = 'match' | 'swap' | 'odd' | 'skip'

/** 整行（整体出装风气）对比状态 */
export type BuildOverallState = 'match' | 'swap' | 'odd' | 'none'

export interface BuildDiff {
  /** 7 槽逐一状态（与传入 items 一一对应，索引 = 槽位） */
  slots: BuildSlotState[]
  /** 整体判定 */
  overall: BuildOverallState
  /** 实际出装件数（id>0 且非饰品） */
  equipped: number
  /** 与推荐重合件数 */
  matched: number
}

/**
 * 出装对比判定：玩家 7 件 vs 推荐 7 件（按槽位一对一比较）。
 *
 * 判定规则（设计文档 §6.2-2「黄色=换装，红色=乱出」）：
 * - 玩家槽为空或饰品 → `skip`（不参与统计）；
 * - 同槽位 id 相同 → `match`；
 * - 同槽位 id 不同且推荐该槽有数据 → `swap`（换装，黄）；
 * - 同槽位 id 不同且推荐该槽无推荐 → `odd`（乱出，红）——推荐位空置代表
 *   玩家出了推荐体系外的东西（如买鞋进 1 号槽 VS 推荐核心件）。
 *
 * 整体判定：equipped ≥ 4（已形成可评判的构建）时，
 * - `matched ≥ ceil(equipped * 0.6)` → `match`；
 * - `matched ≥ ceil(equipped * 0.3)` → `swap`（部分换装）；
 * - 否则 → `odd`；
 * - equipped < 4（出装不完整，如 15 分钟内的对局）→ `none`（不评判）。
 *
 * @param playerItems - LCU 7 槽装备 id（PlayerStats.item0..6，0 = 空）
 * @param recommendItems - 推荐 7 槽（每槽可为 null/undefined；null = 整行无推荐）
 * @returns 差异结构；equipped 为 0 时 overall 恒 `none`
 */
export function diffBuild(
  playerItems: number[],
  recommendItems: (ItemStat | null)[] | null | undefined
): BuildDiff {
  const recIds = (recommendItems ?? []).map(slot => (slot ? slot.itemId : 0))
  const hasRec = recIds.some(id => id > 0)

  const slots: BuildSlotState[] = playerItems.slice(0, 7).map((itemId, i) => {
    const recId = recIds[i] ?? 0
    if (!hasRec) return 'skip'
    if (itemId <= 0 || WARD_ITEM_IDS.has(itemId)) return 'skip'
    if (itemId === recId && recId > 0) return 'match'
    if (recId > 0) return 'swap'
    return 'odd'
  })

  const equipped = slots.filter(s => s !== 'skip').length
  const matched = slots.filter(s => s === 'match').length

  let overall: BuildOverallState = 'none'
  if (hasRec && equipped >= 4) {
    if (matched >= Math.ceil(equipped * 0.6)) overall = 'match'
    else if (matched >= Math.ceil(equipped * 0.3)) overall = 'swap'
    else overall = 'odd'
  }

  return { slots, overall, equipped, matched }
}

/** 出装对比行的单元格内容（由 buildCompareRow 装配，列序与 players 一致） */
export interface BuildCompareCell {
  /** 对应玩家（透视表列序成员） */
  player: StatsTablePlayer
  /** 差异判定（含逐槽状态） */
  diff: BuildDiff
  /** 该玩家英雄的推荐（null = 无推荐，该列显示「暂无」而非乱出） */
  recommend: (ItemStat | null)[] | null
}

/**
 * 装配出装对比行：10 人各自 7 件 vs「该英雄的推荐 7 件」。
 *
 * 推荐按玩家自身英雄取（recommendByChampion[championId]），每人英雄不同，
 * 所以不允许传单份推荐——必须以英雄 → 推荐槽的映射传入。
 *
 * @param players - 已排序（蓝→红）的 10 人玩家
 * @param itemIdsOf - 取玩家 7 槽装备 id（容器统一口径 ctx.itemIds）
 * @param recommendByChampion - 英雄 id → 推荐 7 槽；无该英雄推荐时为 undefined
 * @returns 与 players 一一对应的对比单元格
 */
export function buildCompareRow(
  players: StatsTablePlayer[],
  itemIdsOf: (stats: ParticipantStats) => number[],
  recommendByChampion: ReadonlyMap<number, (ItemStat | null)[] | null> = new Map()
): BuildCompareCell[] {
  return players.map(player => {
    const recommend = recommendByChampion.get(player.championId) ?? null
    const diff = diffBuild(itemIdsOf(player.stats), recommend)
    return { player, diff, recommend }
  })
}
