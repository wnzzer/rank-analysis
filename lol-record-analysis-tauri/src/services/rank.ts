/**
 * 段位数据访问封装（按 PUUID 查询）
 *
 * 对应 Rust command `get_rank_by_puuid`（`command/rank.rs`）。
 *
 * 战绩详情页一局 10 个玩家、用户来回翻详情页会反复打开同一批对局，
 * 因此这里维护一个模块级 puuid → Rank 缓存：
 * - 缓存命中直接返回，不再打 LCU
 * - 同一 puuid 的并发请求共享同一个 in-flight Promise（经典去重写法），
 *   避免同一批玩家里出现重复 puuid，或用户快速切换详情页时打出多份重复请求
 * - 无 TTL：段位在一次客户端会话内不会变化，不需要过期
 * - 失败（网络错误 / LCU 未运行等）不写入缓存，返回 null 而不抛错——
 *   数据缺失是常态降级，与 `src/services/opgg.ts` 的既有风格一致；
 *   不写缓存是为了让用户下次打开详情页时还能重试
 */

import { invoke } from '@tauri-apps/api/core'
import type { Rank } from '@renderer/types/domain/player'

/**
 * puuid → 缓存条目。
 * 请求进行中时存 in-flight Promise，落地后替换为解析出的 Rank，
 * 这样后续命中缓存的调用不必再走一次 Promise 链。
 */
const rankCache = new Map<string, Rank | Promise<Rank | null>>()

/**
 * 按 puuid 获取段位信息，带模块级缓存与并发去重。
 * @param puuid - 召唤师 PUUID，空字符串直接返回 null（不发请求也不占缓存）
 * @returns 段位信息；请求失败或 puuid 为空时返回 null
 */
export async function getRankByPuuid(puuid: string): Promise<Rank | null> {
  if (!puuid) return null

  const cached = rankCache.get(puuid)
  if (cached !== undefined) return cached

  const pending: Promise<Rank | null> = (async () => {
    try {
      const result = await invoke<Rank>('get_rank_by_puuid', { puuid })
      rankCache.set(puuid, result)
      return result
    } catch (error) {
      console.warn(`[rank] getRankByPuuid failed for puuid ${puuid}:`, error)
      // 失败不留缓存，下次调用能重新发起请求
      rankCache.delete(puuid)
      return null
    }
  })()

  rankCache.set(puuid, pending)
  return pending
}

/** 清空段位缓存。供测试用例隔离状态，或未来需要强制刷新时使用。 */
export function clearRankCache(): void {
  rankCache.clear()
}
