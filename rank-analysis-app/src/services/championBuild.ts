/**
 * 英雄推荐构筑访问封装
 *
 * 对应 Rust `command/champion_build.rs`（查询）的类型安全包装，与 `services/opgg.ts`
 * 同一惯例：网络型失败吞掉返回 null——数据缺失是常态降级，推荐栏直接不渲染。
 *
 * @module services/championBuild
 */

import { invoke } from '@tauri-apps/api/core'
import type { ChampionBuild, RuneBuild } from '@renderer/types/championBuild'

/**
 * 样本阈值：低于它的构筑不作为推荐 / 自动应用候选。
 * 必须与 Rust `opgg::detail::MIN_BUILD_PLAY` 一致。
 */
export const MIN_BUILD_PLAY = 200

/**
 * 查询某英雄的推荐构筑
 * @param championId - 英雄 ID
 * @param gameMode - LCU gameMode（CLASSIC / ARAM / KIWI ...），后端据此判定 ranked / aram / 不推荐
 * @param position - 我的分配分路（LCU 小写），无分配传空串或 null
 * @returns 构筑；模式不支持、源被关闭、拉取失败且无缓存时为 null
 */
export async function fetchChampionBuild(
  championId: number,
  gameMode: string,
  position: string | null
): Promise<ChampionBuild | null> {
  try {
    return await invoke<ChampionBuild | null>('get_champion_build', {
      championId,
      gameMode,
      position: position || null
    })
  } catch (error) {
    console.warn(`[championBuild] fetch failed for champion ${championId}:`, error)
    return null
  }
}

/**
 * 从构筑里挑出要推荐 / 应用的那套符文
 *
 * 取第一套样本达标（`play >= MIN_BUILD_PLAY`）的构筑；全部不达标时仍给第一套
 * 供参考，但 `sufficient=false`——展示可以，应用按钮要禁用。
 *
 * @param build - 推荐构筑，可为 null
 * @returns 推荐符文（无符文时为 null）与样本是否充足
 * @example
 * ```ts
 * const { rune, sufficient } = pickRecommendedRune(build)
 * if (rune && sufficient) await applyRunePage(...)
 * ```
 */
export function pickRecommendedRune(build: ChampionBuild | null): {
  rune: RuneBuild | null
  sufficient: boolean
} {
  const runes = build?.runes ?? []
  const qualified = runes.find(r => r.play >= MIN_BUILD_PLAY)
  if (qualified) return { rune: qualified, sufficient: true }
  return { rune: runes[0] ?? null, sufficient: false }
}
