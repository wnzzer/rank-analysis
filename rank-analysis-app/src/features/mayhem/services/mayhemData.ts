/**
 * Mayhem（海克斯大乱斗 queueId 2400）数据服务
 *
 * 封装 Rust 侧 mayhem 数据同步与读取命令（src-tauri/src/command/mayhem.rs）。
 * 数据源：aramgg 公开客户端 API，版本化 JSON 落地临时目录、本地优先读取。
 *
 * 数据契约（2026-08-26 实测钉死，字段随上游演进以可选为主）：
 * - champions.json → { champions: MayhemChampion[] }
 * - augments.json → { total, data: MayhemAugment[] }（含 stages 轮次 / topChampions 适配英雄）
 * - champion-shards/* → 每英雄：augments（自采胜率口径）/ augmentTrios / builds（出装流派，
 *   含召唤师技能组合、18 级加点、核心三件套、情境装、出门装、延伸件）
 */

import { invoke } from '@tauri-apps/api/core'

// ---------------------------------------------------------------------------
// 英雄榜
// ---------------------------------------------------------------------------

/** 英雄榜单条目 */
export interface MayhemChampionStats {
  /** 官方 T 级 1-5；无数据为 null */
  tier: number | null
  wins: number | null
  games: number | null
  /** 胜率小数（0.5772 = 57.72%） */
  winRate: number | null
  /** 选取率小数 */
  pickRate: number | null
  gamePatch: string
  date: string
  source: string
  region: string
}

/** 英雄榜单条目（name=称号如"暗夜猎手"，title=名字如"薇恩"——上游即此语义） */
export interface MayhemChampion {
  id: number
  alias: string
  name: string
  title: string
  roles: string[]
  iconUrl: string
  stats: MayhemChampionStats
}

/** 本地数据状态 */
export interface MayhemStatus {
  activeVersion: string | null
  syncedAt: number | null
  ready: boolean
}

/** 同步报告；null 表示本地已是最新 */
export interface MayhemSyncReport {
  fromVersion: string | null
  toVersion: string
  files: number
  bytes: number
}

// ---------------------------------------------------------------------------
// 强化榜 / 强化引用
// ---------------------------------------------------------------------------

/** 强化统计（榜单与英雄页共用；字段按上游实测全部可选） */
export interface MayhemAugmentStats {
  tier: number | null
  wins: number | null
  games: number | null
  winRate: number | null
  pickRate: number | null
  source?: string
  region?: string
  gamePatch?: string
  date?: string
  /** 英雄页强化条目的胜率为 aramgg_client 自采口径（WORLD，≥255 场才展示） */
  winRateSource?: string
  winRateRegion?: string
  winRateMinimumGames?: number
  /** 在该英雄可用强化中的名次 */
  rank?: number
  total?: number
}

/** 强化榜条目 */
export interface MayhemAugment {
  id: number
  name: string
  rarity: number
  rarityName: string
  rarityDisplayName: string
  iconUrl: string
  key: string
  enabled: boolean
  description?: string
  tooltip?: string
  statsAvailable: boolean
  stats: MayhemAugmentStats
  /** 各选择轮次的分轮统计（形状随上游演进，用 bestStage 提取） */
  stages: Array<Record<string, unknown>>
  /** 最适配的英雄列表 */
  topChampions: MayhemChampionRef[]
}

/** 强化适配英雄引用（榜单 topChampions 用，stats 通常为 null） */
export interface MayhemChampionRef {
  rank?: number
  id: number
  alias: string
  name: string
  title: string
  roles: string[]
  iconUrl: string
  stats: MayhemAugmentStats | null
}

// ---------------------------------------------------------------------------
// 英雄详情（champion-shards）
// ---------------------------------------------------------------------------

/** 通用统计块（games/wins 必有，其余可选） */
export interface StatBlock {
  games: number
  wins: number
  pickRate?: number
  winRate: number
  adjustedWinRate?: number
}

/** 召唤师技能组合 */
export interface SummonerSpellCombo {
  summonerSpellIds: number[]
  games: number
  wins: number
  pickRate: number
  winRate: number
}

/** 一条技能加点路线（18 格） */
export interface SkillOrderEntry {
  skillOrder: number[]
  skillKeys: string[]
  games: number
  wins: number
  pickRate: number
  winRate: number
}

/** 核心装备组合（N 件套） */
export interface CoreItemSet {
  itemIds: number[]
  games: number
  wins: number
  pickRate?: number
  winRate: number
}

/** 核心组合的延伸件（下一件推荐） */
export interface ItemExtension {
  coreItemIds: number[]
  step: number
  itemIds: number[]
  games: number
  wins: number
  winRate: number
}

/** 情境装备（相对胜率提升的差异化装备） */
export interface SituationalItem {
  id: number
  games: number
  wins: number
  pickRate: number
  winRate: number
  distinctiveScore: number
  averageIndex: number
}

/** 出门装组合 */
export interface StartingItemsEntry {
  itemIds: number[]
  games: number
  wins: number
  pickRate: number
  winRate: number
}

/** 一个出装流派（tags.primary_tags_f3pie 为流派名，如 "AD, On-Hit"） */
export interface MayhemBuild {
  patch: string
  queueId: number
  role: string
  tier: string
  tags: Record<string, string>
  stats: StatBlock
  summonerSpells: SummonerSpellCombo[]
  skillOrders: SkillOrderEntry[]
  coreItems: CoreItemSet[]
  fullItems?: CoreItemSet[]
  itemExtensions: ItemExtension[]
  situationalItems: SituationalItem[]
  startingItems: StartingItemsEntry[]
}

/** 三强化组合 */
export interface AugmentTrio {
  augmentIds: number[]
  stats: { games: number; wins: number; winRate: number; pickRate: number; tier: null }
  games: number
  winRateTier: string | null
  pickRateTier: string | null
}

/** 英雄详情条目（champion-shards 中按 id 取出的对象） */
export interface ChampionDetailEntry {
  champion: MayhemChampion
  augments: Array<{
    id: number
    name: string
    rarity: number
    rarityName: string
    rarityDisplayName: string
    iconUrl: string
    stats: MayhemAugmentStats
  }>
  /** 上游当前恒为空数组，保留占位 */
  items?: unknown
  augmentTrios: AugmentTrio[]
  builds: MayhemBuild[]
  relatedBlogs?: Array<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// IPC 封装
// ---------------------------------------------------------------------------

/** 查询本地数据状态（离线可用） */
export async function getMayhemStatus(): Promise<MayhemStatus> {
  return (await invoke('mayhem_status')) as MayhemStatus
}

/**
 * 同步远端数据到本地。
 * @param force 强制重新下载（默认 false，版本一致时跳过）
 * @returns null 表示已是最新版本
 */
export async function syncMayhemData(force = false): Promise<MayhemSyncReport | null> {
  return (await invoke('mayhem_sync', { force })) as MayhemSyncReport | null
}

/** 英雄榜响应 */
export interface MayhemChampionsResponse {
  champions: MayhemChampion[]
}

/** 读取英雄榜原始 JSON */
export async function getMayhemChampions(): Promise<MayhemChampionsResponse> {
  return (await invoke('mayhem_get_champions')) as MayhemChampionsResponse
}

/** 强化榜响应（外层带 total/dataVersion 等元信息） */
export interface MayhemAugmentsResponse {
  total?: number
  dataVersion?: string
  data?: MayhemAugment[]
}

/** 读取强化榜原始 JSON */
export async function getMayhemAugments(): Promise<MayhemAugmentsResponse> {
  return (await invoke('mayhem_get_augments')) as MayhemAugmentsResponse
}

/** 读取单英雄大乱斗详情；null 表示未同步或该英雄无数据 */
export async function getMayhemChampionDetail(
  championId: number
): Promise<ChampionDetailEntry | null> {
  return (await invoke('mayhem_get_champion_detail', {
    championId
  })) as ChampionDetailEntry | null
}

// ---------------------------------------------------------------------------
// 个人自采（mayhem.db，数据不出设备）
// ---------------------------------------------------------------------------

/** 导入报告 */
export interface MayhemImportReport {
  scanned: number
  imported: number
  skippedExisting: number
  failed: number
}

/** 本人英雄聚合行 */
export interface MyChampionStat {
  championId: number
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
}

/** 本人强化聚合行 */
export interface MyAugmentStat {
  augmentId: number
  games: number
  wins: number
}

/**
 * 从本机 LCU 战绩导入最近的海克斯大乱斗对局（幂等）。
 * 需要客户端在线；单次 LCU 请求即可完成。
 */
export async function importMayhemRecent(): Promise<MayhemImportReport> {
  return (await invoke('mayhem_import_recent')) as MayhemImportReport
}

/** 本人英雄维度聚合（按场次降序） */
export async function getMyChampionStats(): Promise<MyChampionStat[]> {
  return (await invoke('mayhem_personal_champion_stats')) as MyChampionStat[]
}

/**
 * 本人强化维度聚合。
 * @param championId 提供时只统计该英雄的对局
 */
export async function getMyAugmentStats(championId?: number): Promise<MyAugmentStat[]> {
  return (await invoke('mayhem_personal_augment_stats', {
    championId
  })) as MyAugmentStat[]
}

// ---------------------------------------------------------------------------
// 版本变动监控（A9）
// ---------------------------------------------------------------------------

/** T 级跃迁条目 */
export interface AugmentTierMove {
  augmentId: number
  fromTier: number | null
  toTier: number | null
}

/** 胜率显著漂移（deltaPp 为百分点，如 -2.31） */
export interface AugmentWrDrift {
  augmentId: number
  deltaPp: number
}

/** 单个版本区间的强化池/数值变动 */
export interface MayhemVersionChange {
  fromVersion: string
  toVersion: string
  recordedAt: number
  added: number[]
  removed: number[]
  tierMoves: AugmentTierMove[]
  wrDrifts: AugmentWrDrift[]
}

/** 版本变动日志（新 → 旧）；首次同步前为空表 */
export async function getMayhemVersionChanges(): Promise<MayhemVersionChange[]> {
  return (await invoke('mayhem_version_changes')) as MayhemVersionChange[]
}

// ---------------------------------------------------------------------------
// 纯工具（供视图复用与单测）
// ---------------------------------------------------------------------------

/**
 * 去除上游富文本描述中的标签并还原常见实体。
 *
 * 上游 description/tooltip 形如 "获得<scaleAF>适应之力</scaleAF>…"，
 * 直接展示需要剥离所有 `<…>` 标记（含自闭合），仅保留中文正文。
 */
export function stripRichText(raw: string | undefined | null): string {
  if (!raw) return ''
  // <br> 视为词间空格，避免相邻行粘连
  const noTags = raw.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')
  const decoded = noTags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  return decoded.replace(/\s+/g, ' ').trim()
}

/**
 * 从强化的 stages 分轮统计中提取「收益最高的选择轮次」（1-4）。
 *
 * stages 条目形状随上游演进，这里做防御性解析：
 * 兼容 `{ stage, stats: { winRate } }` 与扁平 `{ stage, winRate }` 两种形态；
 * 解析不出任何有效轮次返回 null。
 */
export function bestStage(stages: Array<Record<string, unknown>>): number | null {
  let best: { stage: number; wr: number } | null = null
  for (const s of stages ?? []) {
    const rawStage = (s['stage'] ?? s['slot'] ?? s['pick']) as unknown
    const stage =
      typeof rawStage === 'number' ? rawStage : Number.parseInt(String(rawStage ?? ''), 10)
    if (!Number.isFinite(stage)) continue
    const stats = (s['stats'] ?? {}) as Record<string, unknown>
    const rawWr = (stats['winRate'] ?? s['winRate']) as unknown
    const wr = typeof rawWr === 'number' ? rawWr : Number.parseFloat(String(rawWr ?? ''))
    if (!Number.isFinite(wr)) continue
    if (!best || wr > best.wr) best = { stage, wr }
  }
  return best ? Math.min(Math.max(best.stage, 1), 4) : null
}
