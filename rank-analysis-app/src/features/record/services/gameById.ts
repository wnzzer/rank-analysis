/**
 * get_game_by_id 局级缓存（模块级 LRU，上限防爆）。
 *
 * 同一场对局会在多处被拉取：战绩页「宿敌/胜率弹窗」跳转补拉（MatchHistory.focusGame）、
 * 对局页「遇见过」模态框（MettingPlayersCard.openGameDetail）等。对局数据不可变，
 * 缓存天然有效 —— 重复展开零额外 IPC。
 *
 * 注意：与 `services/sgp.ts` 的 SGP 详情缓存职责不同，这里只覆盖「按 gameId 拉完整对局」。
 */

import { invoke } from '@tauri-apps/api/core'
import type { Game } from '@renderer/types/domain/match'

/** 缓存上限：超过后按插入顺序淘汰最旧一条（FIFO） */
const CACHE_MAX = 200

const cache = new Map<number, Promise<Game | null>>()

/**
 * 按 gameId 取完整对局，带模块级缓存。
 * - 命中缓存直接返回同一 Promise（并发去重）
 * - 底层 IPC 失败时打日志并返回 null（调用方按「取不到」处理），不抛异常
 */
export function getGameById(gameId: number): Promise<Game | null> {
  const cached = cache.get(gameId)
  if (cached !== undefined) return cached

  const pending = invoke<Game>('get_game_by_id', { gameId }).catch(err => {
    console.error('[gameById] get_game_by_id failed:', err)
    // 失败不落缓存：下次调用重试真实 IPC，避免一次抖动让某场对局永远取不到
    cache.delete(gameId)
    return null
  })

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(gameId, pending)
  return pending
}

/** 清空缓存（仅测试需要，业务代码不要调用） */
export function clearGameByIdCache(): void {
  cache.clear()
}
