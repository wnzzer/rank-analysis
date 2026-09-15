/**
 * 英雄推荐构筑访问封装
 *
 * 对应 Rust `command/champion_build.rs`（查询）的类型安全包装，与 `services/opgg.ts`
 * 同一惯例：网络型失败吞掉返回 null——数据缺失是常态降级，推荐栏直接不渲染。
 *
 * @module services/championBuild
 */

import { invoke } from '@tauri-apps/api/core'
import type {
  AppliedRuneKey,
  ApplyRuneResult,
  ChampionBuild,
  RuneBuild
} from '@renderer/types/championBuild'

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
 * 把一套符文写成客户端的临时符文页（找到自己建的「(RA)」页就原地改写，否则新建）
 * @param championId - 英雄 ID（决定页名）
 * @param position - 构筑分路（LCU 小写，大乱斗 none）
 * @param rune - 要写入的那套符文
 * @returns 写入结果；命令本身异常（IPC 故障）也归一成 `ok=false`，不向上抛
 */
export async function applyRunePage(
  championId: number,
  position: string,
  rune: RuneBuild
): Promise<ApplyRuneResult> {
  try {
    return await invoke<ApplyRuneResult>('apply_rune_page', { championId, position, rune })
  } catch (error) {
    console.warn(`[championBuild] apply failed for champion ${championId}:`, error)
    return { ok: false, page_id: null, reason: 'lcu_unavailable' }
  }
}

/**
 * 本次选人期最近一次成功写入的内容（手动或自动），用于恢复「已应用」状态
 * @returns 写入记录；没有或查询失败为 null
 */
export async function fetchLastAppliedRune(): Promise<AppliedRuneKey | null> {
  try {
    return (await invoke<AppliedRuneKey | null>('get_last_applied_rune')) ?? null
  } catch (error) {
    console.warn('[championBuild] fetch last applied rune failed:', error)
    return null
  }
}

/**
 * LCU `selectedPerkIds` 顺序的 9 个符文：主系 4 → 副系 2 → 属性 3
 * @param rune - 一套符文构筑
 * @returns 9 个符文 id
 */
export function perkIdsOf(rune: RuneBuild): number[] {
  return [...rune.primary_perk_ids, ...rune.sub_perk_ids, ...rune.stat_mod_ids]
}

/**
 * 一条写入记录是否就是「这个英雄的这套符文」
 * @param championId - 当前英雄
 * @param rune - 当前推荐的那套符文
 * @param applied - 后端的写入记录或事件（只看英雄与 9 个符文）
 * @returns 英雄相同且 9 个符文逐位相同
 */
export function isSameRune(
  championId: number,
  rune: RuneBuild,
  applied: { champion_id: number; perk_ids: number[] }
): boolean {
  const ids = perkIdsOf(rune)
  return (
    applied.champion_id === championId &&
    applied.perk_ids.length === ids.length &&
    applied.perk_ids.every((id, i) => id === ids[i])
  )
}

/**
 * 写入失败原因 → 用户可读文案
 *
 * 页满时明确让用户自己删一页——我们绝不替用户删符文页。
 *
 * @param reason - ApplyRuneResult.reason
 * @returns toast 文案
 */
export function applyFailureText(reason: string | null): string {
  switch (reason) {
    case 'page_limit_full':
      return '符文页已满，请手动删除一页后重试'
    case 'lcu_rejected':
      return '客户端拒绝了这套符文，可能是版本不一致'
    case 'lcu_unavailable':
      return '未连接到客户端，符文未写入'
    default:
      return '符文应用失败'
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
