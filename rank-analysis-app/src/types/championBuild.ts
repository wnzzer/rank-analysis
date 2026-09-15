/**
 * 英雄推荐构筑（OP.GG 详情裁剪后）
 *
 * 与 Rust `opgg::detail` 的同名结构同构，字段保持 snake_case（后端未做 camelCase 重命名）。
 * 由 `get_champion_build` 命令返回，选人期推荐栏与符文页应用共用。
 *
 * @module types/championBuild
 */

/** 一套完整的符文构筑，字段与 LCU 符文页一一对应 */
export interface RuneBuild {
  /** 主系（OP.GG `primary_page_id`）→ LCU `primaryStyleId` */
  primary_style_id: number
  /** 副系（OP.GG `secondary_page_id`）→ LCU `subStyleId` */
  sub_style_id: number
  /** 主系 4 个，首个为基石 */
  primary_perk_ids: number[]
  /** 副系 2 个 */
  sub_perk_ids: number[]
  /** 属性碎片 3 个 */
  stat_mod_ids: number[]
  play: number
  win: number
  /** 该套构筑在该英雄 / 分路下的出场率 0~1 */
  pick_rate: number
}

/** 一组 id（召唤师技能 / 出门装 / 鞋 / 核心装 / 后期装）及其统计 */
export interface IdsEntry {
  ids: number[]
  play: number
  win: number
  pick_rate: number
}

/** 一套加点顺序（15 项 Q/W/E/R）及其统计 */
export interface SkillBuild {
  order: string[]
  play: number
  win: number
  pick_rate: number
}

/**
 * 符文页写入结果（Rust `command::rune_page::ApplyRuneResult`）
 * @property reason - 失败原因：page_limit_full | lcu_rejected | lcu_unavailable
 */
export interface ApplyRuneResult {
  ok: boolean
  page_id: number | null
  reason: string | null
}

/**
 * 最近一次成功写入的内容（Rust `command::rune_page::AppliedKey`），生命周期 = 一次选人期
 * @property perk_ids - 9 个符文，顺序主系 4 → 副系 2 → 属性 3
 */
export interface AppliedRuneKey {
  champion_id: number
  position: string
  primary_style_id: number
  sub_style_id: number
  perk_ids: number[]
}

/**
 * `get_last_applied_rune` 的返回：写入记录 + 该英雄该分路是否已被手动接管
 * （手动应用过后自动任务本次选人期不再写入，前端据此不显示「自动应用中…」）
 */
export interface LastAppliedRune extends AppliedRuneKey {
  manual_override: boolean
}

/**
 * 我的符文方案（Rust `command::rune_preset::RunePreset`），按「英雄 + 分路」唯一，
 * 存于配置 `settings.auto.runePresets`
 * @property position - LCU 小写分路；大乱斗为 none
 * @property saved_at - 保存时刻（unix 毫秒）
 * @property source - 本期恒为 opgg；预留 client（记住客户端当前页）
 */
export interface RunePreset {
  champion_id: number
  position: string
  primary_style_id: number
  sub_style_id: number
  primary_perk_ids: number[]
  sub_perk_ids: number[]
  stat_mod_ids: number[]
  saved_at: number
  source: 'opgg' | 'client'
}

/** 没记住方案的英雄用什么兜底（配置 `settings.auto.runeFallback`，缺省 opgg） */
export type RuneFallback = 'opgg' | 'none'

/**
 * 推荐栏里的一张方案卡
 * @property key - opgg-{序号} 或 preset（我的方案且不在 OP.GG 列表里）
 * @property starred - 是否就是「我的方案」
 * @property sufficient - 样本是否达标（我的方案恒为 true）
 */
export interface RuneOption {
  key: string
  rune: RuneBuild
  source: 'preset' | 'opgg'
  starred: boolean
  sufficient: boolean
}

/** 自动应用任务每次写入后推送的 `rune-apply-result` 事件载荷 */
export interface RuneApplyEvent {
  champion_id: number
  perk_ids: number[]
  ok: boolean
  reason: string | null
}

/** 某英雄在某分路 / 模式 / 段位下的推荐构筑 */
export interface ChampionBuild {
  schema_version: number
  champion_id: number
  /** LCU 小写分路 top/jungle/middle/bottom/utility；大乱斗为 none */
  position: string
  mode: 'ranked' | 'aram'
  /** 段位分段；大乱斗恒为 all */
  tier: string
  /** OP.GG 版本号，如 "16.18" */
  patch: string
  fetched_at: number
  /** 该分路（大乱斗为全体）样本场次 */
  play: number
  /** 该分路（大乱斗为全体）胜率 0~1 */
  win_rate: number
  /** 按出场率降序，至多 3 套 */
  runes: RuneBuild[]
  spells: IdsEntry[]
  starter_items: IdsEntry[]
  boots: IdsEntry[]
  core_items: IdsEntry[]
  last_items: IdsEntry[]
  skills: SkillBuild[]
  /** 拉取失败时降级返回的旧版本数据（前端据此提示「版本 X」） */
  stale: boolean
}
