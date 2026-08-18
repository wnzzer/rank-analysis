/**
 * 已拥有英雄查询封装
 *
 * 对应 Rust command（`command/owned.rs` + `lcu/api/owned.rs`，端点为
 * `lol-champions/v1/owned-champions-minimal`）。
 *
 * 排位选人只能选已拥有的英雄：推荐面板的「仅已拥有」筛选依赖本模块。
 * - 失败降级：invoke 异常返回 null（不抛错），调用方应「关闭筛选」而非清空候选池
 * - 模块级缓存：同一次启动内账号不变，TTL 内不重复请求
 */

import { invoke } from '@tauri-apps/api/core'

/** 模块级缓存：undefined = 尚未拉取；null 由调用方通过返回值区分（失败不缓存） */
let cachedOwned: number[] | undefined = undefined
let cachedAt = 0

/** 缓存时长（ms）：英雄拥有状态极少变化，60s 内不重复请求 */
const CACHE_TTL_MS = 60_000

/**
 * 获取当前账号已拥有的英雄 ID 数组。
 *
 * @returns 已拥有英雄 ID 数组；请求失败返回 null（调用方降级为不筛拥有状态）
 */
export async function getOwnedChampionIds(): Promise<number[] | null> {
  const now = Date.now()
  if (cachedOwned !== undefined && now - cachedAt < CACHE_TTL_MS) {
    return cachedOwned
  }
  try {
    const ids = await invoke<number[]>('get_owned_champions')
    cachedOwned = ids
    cachedAt = Date.now()
    return ids
  } catch (error) {
    console.warn('[ownedChampions] 已拥有英雄拉取失败，降级为不筛拥有状态:', error)
    return null
  }
}

/** 测试用：清空模块级缓存 */
export function clearOwnedChampionsCache(): void {
  cachedOwned = undefined
  cachedAt = 0
}
