/**
 * 段位数据访问封装（按 PUUID 查询）
 *
 * 对应 Rust command `get_rank_by_puuid` / `get_ranks_by_puuids`（`command/rank.rs`）。
 *
 * 战绩详情页一局 10 个玩家、用户来回翻详情页会反复打开同一批对局，
 * 因此这里维护一个模块级 puuid → Rank 缓存：
 * - 缓存命中直接返回，不再打 IPC / LCU
 * - 同一 puuid 的并发请求共享同一个 in-flight Promise（经典去重写法），
 *   避免同一批玩家里出现重复 puuid，或用户快速切换详情页时打出多份重复请求
 * - 无 TTL：段位在一次客户端会话内不会变化，不需要过期
 * - 失败（网络错误 / LCU 未运行等）不写入缓存，返回 null 而不抛错——
 *   数据缺失是常态降级，与 `src/services/opgg.ts` 的既有风格一致；
 *   不写缓存是为了让用户下次打开详情页时还能重试
 *
 * 批量查询（`getRanksByPuuids`）与单查共用同一份缓存：详情页 10 人走一次
 * IPC 拿全量，之后单查/批量互斥命中（Rust 侧还有 30 分钟 TTL 的缓存兜底）。
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

/**
 * 批量按 puuid 获取段位：一次 IPC 拿整批，结果并入模块级缓存。
 *
 * 详情页 10 人场景替代逐个 {@link getRankByPuuid}（10 次 IPC + 10 次 LCU 往返）。
 * - 已缓存的 puuid（含 in-flight Promise）不再发起请求
 * - 单个玩家失败返回 null 不拖垮整批（Rust 侧语义）；**整批失败**（IPC 中断、
 *   LCU 断开）抛回错误且不写缓存——调用方据此决定是否留待下次重试
 * @param puuids - 召唤师 PUUID 列表；空 puuid 被过滤
 * @returns puuid → 段位信息；单人失败为 null
 */
export async function getRanksByPuuids(puuids: string[]): Promise<Record<string, Rank | null>> {
  const unique = [...new Set(puuids.filter(Boolean))]
  const missing = unique.filter(p => !rankCache.has(p))
  const out: Record<string, Rank | null> = {}

  if (missing.length > 0) {
    const result = await invoke<Record<string, Rank | null>>('get_ranks_by_puuids', {
      puuids: missing
    })
    for (const [puuid, rank] of Object.entries(result)) {
      if (rank) rankCache.set(puuid, rank)
      out[puuid] = rank ?? null
    }
  }

  // 缓存命中部分：已成 Promise 的 in-flight 请求 await 到最终值
  for (const puuid of unique) {
    if (puuid in out) continue
    const cached = rankCache.get(puuid)
    if (cached !== undefined) out[puuid] = await cached
  }
  return out
}

/** 清空段位缓存。供测试用例隔离状态，或未来需要强制刷新时使用。 */
export function clearRankCache(): void {
  rankCache.clear()
}
