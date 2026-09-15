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
  ApplyRuneResult,
  ChampionBuild,
  LastAppliedRune,
  RuneBuild,
  RuneFallback,
  RuneOption,
  RunePreset
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
export async function fetchLastAppliedRune(): Promise<LastAppliedRune | null> {
  try {
    return (await invoke<LastAppliedRune | null>('get_last_applied_rune')) ?? null
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

// ---- 符文方案（多方案卡片 + 我的方案）----

/**
 * 把一套符文存成「我的方案」
 * @param championId - 英雄 ID
 * @param position - 分路（LCU 小写，大乱斗 none）
 * @param rune - 选中的那套符文
 * @param now - 保存时刻（unix 毫秒），测试注入
 * @returns 方案（source 恒为 opgg——本期只能记住推荐栏里的方案）
 */
export function presetFromRune(
  championId: number,
  position: string,
  rune: RuneBuild,
  now: number = Date.now()
): RunePreset {
  return {
    champion_id: championId,
    position,
    primary_style_id: rune.primary_style_id,
    sub_style_id: rune.sub_style_id,
    primary_perk_ids: [...rune.primary_perk_ids],
    sub_perk_ids: [...rune.sub_perk_ids],
    stat_mod_ids: [...rune.stat_mod_ids],
    saved_at: now,
    source: 'opgg'
  }
}

/**
 * 我的方案转成可写入 / 可展示的符文构筑（方案没有样本数据，统计写 0）
 * @param preset - 我的方案
 * @returns 与 Rust `RunePreset::to_rune` 同口径的构筑
 */
export function presetToRune(preset: RunePreset): RuneBuild {
  return {
    primary_style_id: preset.primary_style_id,
    sub_style_id: preset.sub_style_id,
    primary_perk_ids: [...preset.primary_perk_ids],
    sub_perk_ids: [...preset.sub_perk_ids],
    stat_mod_ids: [...preset.stat_mod_ids],
    play: 0,
    win: 0,
    pick_rate: 0
  }
}

/** 两套符文写成页后是否完全一样（两个系 + 9 个符文逐位） */
function sameRunes(a: RuneBuild, b: RuneBuild): boolean {
  const pa = perkIdsOf(a)
  const pb = perkIdsOf(b)
  return (
    a.primary_style_id === b.primary_style_id &&
    a.sub_style_id === b.sub_style_id &&
    pa.length === pb.length &&
    pa.every((id, i) => id === pb[i])
  )
}

/**
 * 推荐栏的方案卡列表
 *
 * OP.GG 每套一张（key `opgg-{序号}`）；我的方案若与某套完全相同就给那张加 ★，
 * 否则在最前面单独一张（key `preset`）——不重复展示同一套符文。
 *
 * @param build - OP.GG 构筑，可为 null（拉不到时只剩我的方案）
 * @param preset - 当前英雄 + 分路的我的方案，可为 null
 * @returns 方案卡，顺序即展示顺序
 */
export function buildRuneOptions(
  build: ChampionBuild | null,
  preset: RunePreset | null
): RuneOption[] {
  const presetRune = preset ? presetToRune(preset) : null
  const opgg: RuneOption[] = (build?.runes ?? []).map((rune, i) => ({
    key: `opgg-${i}`,
    rune,
    source: 'opgg',
    starred: !!presetRune && sameRunes(presetRune, rune),
    sufficient: rune.play >= MIN_BUILD_PLAY
  }))
  if (!presetRune || opgg.some(o => o.starred)) return opgg
  return [
    { key: 'preset', rune: presetRune, source: 'preset', starred: true, sufficient: true },
    ...opgg
  ]
}

/**
 * 默认选中哪张卡：我的方案 → 第一套样本达标的 → 第一套
 * @param options - 方案卡列表
 * @returns 卡片 key；没有卡时为 null
 */
export function defaultOptionKey(options: RuneOption[]): string | null {
  return (
    options.find(o => o.starred)?.key ??
    options.find(o => o.sufficient)?.key ??
    options[0]?.key ??
    null
  )
}

/**
 * 自动应用会写哪张卡（与 Rust `choose_auto_rune` 同口径）：
 * 我的方案 → 兜底为 opgg 时第一套样本达标的 OP.GG 构筑 → 不写
 * @param options - 方案卡列表
 * @param hasPreset - 当前英雄 + 分路是否有我的方案
 * @param fallback - 兜底策略
 * @returns 卡片 key；不会自动写时为 null
 */
export function autoTargetKey(
  options: RuneOption[],
  hasPreset: boolean,
  fallback: RuneFallback
): string | null {
  if (hasPreset) return options.find(o => o.starred)?.key ?? null
  if (fallback !== 'opgg') return null
  return options.find(o => o.source === 'opgg' && o.sufficient)?.key ?? null
}

/** 极地地图的模式：分路统一记为 none（与 Rust `resolve_target` 一致） */
const ARAM_LIKE_MODES = ['ARAM', 'KIWI']
const LANES = ['top', 'jungle', 'middle', 'bottom', 'utility']

/**
 * 匹配「我的方案」用的分路
 *
 * 构筑里的分路是后端解析过的（含匹配自选时的主分路兜底），最准；拉不到构筑时退回
 * 大乱斗类模式为 none、其余用分配分路。都没有（匹配自选且 OP.GG 不可用）时匹配不了。
 *
 * @param build - OP.GG 构筑，可为 null
 * @param gameMode - LCU gameMode
 * @param position - 我的分配分路，可为 null / 空串
 * @returns LCU 小写分路或 none；无法确定时为 null
 */
export function presetPositionOf(
  build: ChampionBuild | null,
  gameMode: string,
  position: string | null
): string | null {
  if (build) return build.position
  if (ARAM_LIKE_MODES.includes(gameMode.toUpperCase())) return 'none'
  const lane = (position ?? '').toLowerCase()
  return LANES.includes(lane) ? lane : null
}
