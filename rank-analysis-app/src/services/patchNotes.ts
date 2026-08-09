/**
 * 版本补丁英雄改动查询（Rust get_champion_patch_note 的类型安全包装）
 *
 * 双源：Rust 端优先走国服中文公告（CN 源，不依赖 patch 号，独立于 OP.GG 可用），
 * 查不到时兜底走 Wiki 英文（需要 patch 号）。patch 版本号取自 OP.GG 状态
 * （ranked 快照），仅 Wiki 兜底路径需要；OP.GG 不可达时以空串调用，
 * 让 CN 源不受影响。网络型失败一律返回 null——无补丁信息是常态降级，
 * 不阻塞选人页渲染。
 */

import { invoke } from '@tauri-apps/api/core'
import { getOpggStatus } from './opgg'

/** 改动整体方向（与 Rust ChangeDirection serde 值一致） */
export type ChangeDirection = 'buff' | 'nerf' | 'adjusted'

export interface ChampionPatchNote {
  /** 展示名：CN 源为「名字（7月16日更新）」格式的中文名，Wiki 兜底源为英文展示名 */
  champion: string
  direction: ChangeDirection
  /** 改动条目：CN 源为公告原文条目（中文），Wiki 兜底源为已清洗 wiki 标记的英文原文 */
  lines: string[]
}

/** 当前 patch 版本号，模块级缓存（一次会话内不变） */
let patchPromise: Promise<string | null> | null = null

/**
 * 取当前 patch 版本号（如 "16.14"）
 * @returns OP.GG 状态里的 patch；不可用时 null
 */
export function getCurrentPatch(): Promise<string | null> {
  if (!patchPromise) {
    patchPromise = getOpggStatus('ranked')
      .then(s => s?.patch ?? null)
      .catch(() => {
        patchPromise = null
        return null
      })
  }
  return patchPromise
}

/** championId → 补丁改动 的模块级缓存（同一英雄多卡片共享） */
const noteCache = new Map<number, Promise<ChampionPatchNote | null>>()

/**
 * 查询英雄在当前版本的官方改动
 * @param championId - 英雄 ID
 * @returns 有改动时返回方向与条目；无改动/不可用返回 null
 */
export function getChampionPatchNote(championId: number): Promise<ChampionPatchNote | null> {
  if (!championId || championId <= 0) return Promise.resolve(null)
  let cached = noteCache.get(championId)
  if (!cached) {
    cached = (async () => {
      // patch 号仅 Wiki 兜底路径需要；OP.GG 不可达时仍以空串调用，让 CN 源独立可用
      const patch = await getCurrentPatch()
      return await invoke<ChampionPatchNote | null>('get_champion_patch_note', {
        championId,
        patch: patch ?? ''
      })
    })().catch(error => {
      console.warn('[patchNotes] getChampionPatchNote failed:', error)
      noteCache.delete(championId)
      return null
    })
    noteCache.set(championId, cached)
  }
  return cached
}
