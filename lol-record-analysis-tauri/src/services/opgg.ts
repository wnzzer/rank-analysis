/**
 * OP.GG 数据访问封装
 *
 * 对应 Rust command/opgg.rs 四命令的类型安全包装。
 * 所有网络型失败吞掉返回 null/空——数据缺失是常态降级。
 */

import { invoke } from '@tauri-apps/api/core'

export type OpggMode = 'ranked' | 'aram'

export interface ChampionMeta {
  championId: number
  position: string
  tier: number
  rank: number
  /** 上一 patch 的同分路排名（0 = 无数据），用于「版本走强/走弱」趋势 */
  rankPrevPatch: number
  winRate: number
  pickRate: number
  banRate: number
  roleRate: number
  isMainPosition: boolean
}

export interface LaneCounter {
  opponentId: number
  position: string
  subjectWinRate: number
  play: number
}

export interface OpggStatus {
  mode: string
  patch: string
  fetchedAt: number
  stale: boolean
  championCount: number
}

export interface CounterHint {
  myChampionId: number
  myWinRate: number
}

/**
 * 将队列 ID 转换为 OP.GG 模式
 * @param queueId - 队列 ID (450=ARAM, 其他=ranked)
 * @returns 'aram' 或 'ranked'
 */
export function queueIdToOpggMode(queueId: number): OpggMode {
  return queueId === 450 ? 'aram' : 'ranked'
}

/**
 * 确保 OP.GG 数据已更新
 * @param mode - 游戏模式
 * @returns 状态对象或 null (网络错误时)
 */
export async function ensureOpggData(mode: OpggMode): Promise<OpggStatus | null> {
  try {
    const result = await invoke('update_opgg_data', { mode })
    return result as OpggStatus
  } catch (error) {
    console.warn(`[opgg] ensureOpggData failed for mode ${mode}:`, error)
    return null
  }
}

/**
 * 获取英雄元数据
 * @param mode - 游戏模式
 * @param championId - 英雄 ID
 * @param position - 位置 (可选)
 * @returns 英雄元数据或 null
 */
export async function getChampionMeta(
  mode: OpggMode,
  championId: number,
  position?: string
): Promise<ChampionMeta | null> {
  try {
    const result = await invoke('get_champion_meta', {
      mode,
      championId,
      ...(position && { position })
    })
    return result as ChampionMeta
  } catch (error) {
    console.warn(`[opgg] getChampionMeta failed for champion ${championId}:`, error)
    return null
  }
}

/**
 * 获取多个英雄的克制信息
 * @param mode - 游戏模式
 * @param championIds - 英雄 ID 列表
 * @returns 按英雄 ID 索引的克制列表 Map
 */
export async function getLaneCounters(
  mode: OpggMode,
  championIds: number[]
): Promise<Record<number, LaneCounter[]>> {
  try {
    const result = await invoke('get_lane_counters', {
      mode,
      championIds
    })
    return result as Record<number, LaneCounter[]>
  } catch (error) {
    console.warn(`[opgg] getLaneCounters failed for champions [${championIds}]:`, error)
    return {}
  }
}

/**
 * 获取 OP.GG 数据状态
 * @param mode - 游戏模式
 * @returns 状态对象或 null
 */
export async function getOpggStatus(mode: OpggMode): Promise<OpggStatus | null> {
  try {
    const result = await invoke('get_opgg_status', { mode })
    return result as OpggStatus
  } catch (error) {
    console.warn(`[opgg] getOpggStatus failed for mode ${mode}:`, error)
    return null
  }
}

/**
 * 纯函数：分析敌方英雄是否被我方某英雄克制
 *
 * 语义：countersByChampion[c] 是英雄 c 最难打的对手列表，subjectWinRate 是 c 对该对手的胜率
 *
 * 返回条件：
 * 1. 若 countersByChampion[enemyId] 中存在 opponentId ∈ myChampionIds 的条目
 *    → 敌人怕我方该英雄，返回 { myChampionId: opponentId, myWinRate: 1 - subjectWinRate }
 * 2. 若 countersByChampion[myId] 中存在 opponentId === enemyId
 *    → 我方该英雄被敌人克制，返回 { myChampionId: myId, myWinRate: subjectWinRate }
 *
 * 去重：同 myChampionId 取样本大的 (play 值更大)
 * 排序：按 |0.5 - myWinRate| 降序（偏离 50% 胜率越大越优先）
 * 最多：返回 2 条
 *
 * @param enemyId - 敌方英雄 ID
 * @param myChampionIds - 我方英雄 ID 列表
 * @param countersByChampion - 克制关系 Map
 * @returns 克制提示列表 (最多 2 条)
 */
export function findCounterHints(
  enemyId: number,
  myChampionIds: number[],
  countersByChampion: Record<number, LaneCounter[]>
): CounterHint[] {
  // 使用 Map 进行去重和合并
  const hints = new Map<number, { hint: CounterHint; play: number }>()

  // 情况 1：敌方英雄的克制列表中有我方某英雄
  // countersByChampion[enemyId] = 敌方英雄最怕的对手列表
  const enemyCounters = countersByChampion[enemyId] || []
  for (const counter of enemyCounters) {
    if (myChampionIds.includes(counter.opponentId)) {
      const myChampionId = counter.opponentId
      // 敌人怕我方英雄，所以我方胜率 = 1 - (敌人对我方的胜率)
      const myWinRate = 1 - counter.subjectWinRate
      const key = myChampionId

      // 去重：保留 play 更大的
      if (!hints.has(key) || hints.get(key)!.play < counter.play) {
        hints.set(key, {
          hint: { myChampionId, myWinRate },
          play: counter.play
        })
      }
    }
  }

  // 情况 2：我方英雄的克制列表中有敌方英雄
  for (const myChampionId of myChampionIds) {
    const myCounters = countersByChampion[myChampionId] || []
    for (const counter of myCounters) {
      if (counter.opponentId === enemyId) {
        // 我方英雄被敌人克制，胜率直接用
        const myWinRate = counter.subjectWinRate
        const key = myChampionId

        // 去重：保留 play 更大的
        if (!hints.has(key) || hints.get(key)!.play < counter.play) {
          hints.set(key, {
            hint: { myChampionId, myWinRate },
            play: counter.play
          })
        }
      }
    }
  }

  // 提取 hints，排序并返回最多 2 条
  const result = Array.from(hints.values())
    .map(({ hint }) => hint)
    .sort((a, b) => {
      // 按 |0.5 - winRate| 降序
      const devA = Math.abs(0.5 - a.myWinRate)
      const devB = Math.abs(0.5 - b.myWinRate)
      return devB - devA
    })
    .slice(0, 2)

  return result
}
