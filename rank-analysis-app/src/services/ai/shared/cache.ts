/**
 * D-P1 磁盘缓存：AI 结构化结果（Stage 1 归因 / Stage 2 草案）经 Rust 命令读写，
 * 按 gameId+patch 分片 + 14 天时效（见 src-tauri/src/command/ai_cache.rs）。
 *
 * IPC 不可用（纯浏览器 / 测试环境）时自动降级 sessionStorage——行为不变，
 * 只是持久性退化为会话级。
 */

import { invoke } from '@tauri-apps/api/core'

/** 版本串 → patch 分片：`25.6.1.123` → `25.6`；缺 version 给 `unknown`。 */
export function dataPatch(gameVersion?: string): string {
  if (!gameVersion) return 'unknown'
  const parts = gameVersion.split('.')
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0]
}

/** 读缓存：磁盘优先，未命中/降级时回退 sessionStorage。 */
export async function aiCacheGet(key: string, patch?: string): Promise<string | null> {
  try {
    const value = await invoke<string | null>('ai_cache_get', { key, patch: patch ?? null })
    if (value) return value
  } catch {
    // IPC 不可用：降级
  }
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

/** 写缓存：磁盘优先，失败时写入 sessionStorage（尽力而为）。 */
export async function aiCachePut(key: string, patch: string, value: string): Promise<void> {
  try {
    await invoke('ai_cache_put', { key, patch, value })
    return
  } catch {
    // IPC 不可用：降级
  }
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // ignore (SSR / no storage)
  }
}
