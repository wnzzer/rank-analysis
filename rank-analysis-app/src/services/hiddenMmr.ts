/**
 * 隐藏分估算访问封装
 *
 * 对应 Rust command `get_hidden_mmr`（`command/hidden_mmr.rs`），类型与
 * `hidden_mmr/estimate.rs` 的 `HiddenMmr` 序列化结果一一对应。
 * 失败（LCU 未连接等）返回 null，不抛错，与 `services/rank.ts` 风格一致。
 */

import { invoke } from '@tauri-apps/api/core'

/** 参与估算的排位队列 */
export type RankedQueueType = 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'

/** 最近一局的 LP 加减分 */
export interface HiddenMmrRecentDelta {
  delta: number
  source: 'notification' | 'snapshot'
}

/**
 * 隐藏分估算结果
 * - hidden：未定级 / 定级赛中，不显示
 * - collecting：数据不足；too_few 为不够 3 局，one_sided 为只有赢局或只有输局
 * - ready：score 为分数轴上的值，equivalent 为等效段位文案，recent 为新 → 旧
 */
export type HiddenMmr =
  | { status: 'hidden' }
  | { status: 'collecting'; reason: 'too_few' | 'one_sided'; have: number; need: number }
  | {
      status: 'ready'
      score: number
      equivalent: string
      offset: number
      direction: 'up' | 'flat' | 'down'
      avgWin: number
      avgLoss: number
      recent: HiddenMmrRecentDelta[]
    }

/** 后端写入新记录后发出的事件，payload 为队列类型 */
export const HIDDEN_MMR_UPDATED_EVENT = 'hidden-mmr-updated'

/**
 * 获取隐藏分估算
 * @param puuid - 当前登录召唤师的 PUUID，空字符串直接返回 null
 * @param queueType - 排位队列
 * @returns 估算结果；请求失败时返回 null
 */
export async function getHiddenMmr(
  puuid: string,
  queueType: RankedQueueType
): Promise<HiddenMmr | null> {
  if (!puuid) return null
  try {
    return await invoke<HiddenMmr>('get_hidden_mmr', { puuid, queueType })
  } catch (error) {
    console.warn(`[hiddenMmr] getHiddenMmr failed for ${queueType}:`, error)
    return null
  }
}
