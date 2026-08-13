/**
 * 出装推荐数据访问封装（PUGG：自有战绩聚合）
 *
 * 对应 Rust command/build_stats.rs 的 get_build_stats。
 * 网络/后端失败统一吞掉返回 null——「暂无推荐」是常态降级路径，不应抛错。
 */

import { invoke } from '@tauri-apps/api/core'

/** 单装备条目：itemId + 使用场次（胜场单独计数，供权重排序与展示）。 */
export interface ItemStat {
  itemId: number
  /** 使用场次（含胜负） */
  count: number
  /** 其中胜场数 */
  winCount: number
}

/** 单符文条目（主系/副系风格 id 或基石 perk id 的频率表通用）。 */
export interface RuneStat {
  /** 风格 id（如 8100=精密）或基石 perk id（如 8112） */
  id: number
  count: number
  winCount: number
}

/** 单召唤师技能条目。 */
export interface SpellStat {
  spellId: number
  count: number
  winCount: number
}

/** 某英雄在某一模式下的出装/符文聚合结果（PUGG）。 */
export interface BuildStats {
  championId: number
  /** 分路（LCU 摘要无可靠 lane 字段，恒为空串） */
  position: string
  /** 模式（queueId；0 = 未过滤的全模式） */
  mode: number
  /** 样本场次 */
  samples: number
  /** 其中胜场数 */
  winCount: number
  /** 7 个出装槽位，每槽按胜场权重降序 */
  items: ItemStat[][]
  /** 主系风格频率表（按胜场权重降序） */
  runeMain: RuneStat[]
  /** 副系风格频率表（按胜场权重降序） */
  runeSub: RuneStat[]
  /** 基石符文（perk0）频率表（按胜场权重降序） */
  keystone: RuneStat[]
  /** 召唤师技能频率表（按胜场权重降序） */
  spells: SpellStat[]
}

/**
 * 基于自有战绩窗口聚合指定英雄的出装/符文统计。
 *
 * @param puuid - 被统计召唤师（当前登录玩家）
 * @param championId - 目标英雄
 * @param mode - queueId 过滤，0 = 不限制模式；缺省 0
 * @returns 聚合结果；样本不足（<5 场）或后端失败时返回 null
 */
export async function getBuildStats(
  puuid: string,
  championId: number,
  mode = 0
): Promise<BuildStats | null> {
  try {
    const result = await invoke('get_build_stats', {
      puuid,
      championId,
      mode
    })
    return result as BuildStats | null
  } catch (error) {
    console.warn(`[builds] getBuildStats failed for champion ${championId}:`, error)
    return null
  }
}

/**
 * 取某槽位的推荐装备（胜场权重最高者）。
 *
 * @param items - BuildStats.items（7 槽位）
 * @param slot - 槽位下标 0..6
 * @returns 该槽位排名第一的装备，无数据时 null
 */
export function topItem(items: ItemStat[][], slot: number): ItemStat | null {
  return items[slot]?.[0] ?? null
}

/**
 * 合并推荐（C3）：输出给 UI 的统一出装/符文推荐。
 *
 * 双源合并规则（设计文档 §6.1 C3）：
 * - PUGG 样本 ≥ [`PUGG_PREFER_SAMPLES`] → 直接采用 PUGG（自有数据可信度高）；
 * - 否则若 OP.GG 有数据 → 采用 OP.GG（外服对照，标注来源防误导）；
 * - 都没有 → null（前端显示"暂无推荐"，优雅降级）。
 *
 * 当前 OP.GG 详情 API 已改版不可用（2026-08 实测 404），实际只会产出 PUGG
 * 来源；合并规则保留双源分支，OP.GG 恢复后无需改 UI 层。
 */

/** PUGG 优先的样本门槛：达到即认为自有数据可信，不再依赖 OP.GG。 */
export const PUGG_PREFER_SAMPLES = 10

/** 推荐来源：'pugg' 自有战绩聚合 / 'opgg' 外服对照数据。 */
export type BuildSource = 'pugg' | 'opgg'

/**
 * 双源合并规则（设计文档 §6.1 C3）：按样本数裁决数据源。
 *
 * - PUGG 样本 ≥40 时采用 PUGG（自有数据可信）；
 * - 否则若有 OP.GG 数据采用 OP.GG（外服对照）；
 * - 都没有 → 无推荐。
 *
 * @param puggSamples - 自有战绩聚合样本数（0 = 无 PUGG 数据）
 * @param hasOpgg - 是否有 OP.GG 出装数据
 * @returns 采用的数据源，双方都无数据时 null
 */
export function resolveBuildSource(puggSamples: number, hasOpgg: boolean): BuildSource | null {
  if (puggSamples >= PUGG_PREFER_SAMPLES) {
    return 'pugg'
  }
  if (hasOpgg) {
    return 'opgg'
  }
  if (puggSamples >= 1) {
    // OP.GG 无数据时，小样本 PUGG 仍是唯一可用来源（标注"样本偏少"防误导）
    return 'pugg'
  }
  return null
}

/** 合并后的统一推荐（C3 输出，前端共享类型）。 */
export interface BuildRecommendation {
  source: BuildSource
  /** 推荐依据的样本数（PUGG 为聚合场次；OP.GG 来源为 0） */
  samples: number
  /** 7 个出装槽位推荐（每槽取频率第一名） */
  items: (ItemStat | null)[]
  /** 主系风格 + 副系风格 + 基石符文（各取频率第一名） */
  runes: { main: RuneStat | null; sub: RuneStat | null; keystone: RuneStat | null }
  /** 召唤师技能（取频率最高的两个） */
  spells: (SpellStat | null)[]
  /** 数据来源与样本说明（顶栏标注防误导） */
  note: string
}

/**
 * 由 PUGG 聚合结果生成统一推荐。
 *
 * @param build - PUGG 聚合结果；null = 无自有数据
 * @param champName - 英雄名（用于标注文案；缺省用英雄 ID）
 * @returns 合并推荐；input 为 null 时返回 null
 */
export function toBuildRecommendation(
  build: BuildStats | null,
  champName?: string
): BuildRecommendation | null {
  if (!build || build.samples < 1) {
    return null
  }

  const label = champName ? champName : `英雄 ${build.championId}`
  const source = resolveBuildSource(build.samples, false) ?? 'pugg'
  const rated =
    source === 'opgg'
      ? '（OP.GG 外服对照数据）'
      : build.samples >= PUGG_PREFER_SAMPLES
        ? ''
        : '（样本偏少，仅供参考）'

  return {
    source,
    samples: build.samples,
    items: build.items.map(slot => slot[0] ?? null),
    runes: {
      main: build.runeMain[0] ?? null,
      sub: build.runeSub[0] ?? null,
      keystone: build.keystone[0] ?? null
    },
    spells: [build.spells[0] ?? null, build.spells[1] ?? null],
    note: `${label}：来自你的近 ${build.samples} 场战绩（胜 ${build.winCount} 场）` + rated
  }
}
