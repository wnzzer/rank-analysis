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
