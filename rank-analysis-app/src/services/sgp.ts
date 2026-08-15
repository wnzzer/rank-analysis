/**
 * SGP（腾讯官方战绩数据通道）访问封装
 *
 * 对应 Rust command（`command/sgp.rs` + `lcu/api/sgp.rs`）。
 *
 * 跨区战绩列表与单局详情（帧数据/事件流/伤害明细）的薄封装：
 * - 错误统一吞掉返回 null / 空数组（数据缺失是常态降级，与 `src/services/opgg.ts` 一致）
 * - 列表页深翻页由 `MatchHistory.vue` 维护 startIndex，这里只做单次拉取
 * - 详情帧数据局级缓存：展开详情时按 gameId 缓存，关页重开零网络
 */

import { invoke } from '@tauri-apps/api/core'
import type { Game, MatchHistory } from '@renderer/types/domain/match'
import type { Rank } from '@renderer/types/domain/player'

/** SGP DETAILS 响应的 `json` 体（与 Rust `SgpGameDetailResponse` 对应，字段全可选容错） */
export interface SgpFramePosition {
  x?: number
  y?: number
}

export interface SgpDamageDetail {
  basic?: boolean | null
  magicDamage?: number | null
  name?: string | null
  participantId?: number | null
  physicalDamage?: number | null
  spellName?: string | null
  spellSlot?: number | null
  trueDamage?: number | null
  type?: string | null
}

export interface SgpFrameDamageStats {
  magicDamageDone?: number | null
  magicDamageDoneToChampions?: number | null
  physicalDamageDone?: number | null
  physicalDamageDoneToChampions?: number | null
  trueDamageDone?: number | null
  trueDamageDoneToChampions?: number | null
  totalDamageDone?: number | null
  totalDamageDoneToChampions?: number | null
  totalDamageTaken?: number | null
}

export interface SgpFrameParticipantStats {
  currentGold?: number
  totalGold?: number
  goldPerSecond?: number
  level?: number
  xp?: number
  minionsKilled?: number
  jungleMinionsKilled?: number
  position?: SgpFramePosition | null
  damageStats?: SgpFrameDamageStats | null
  timeEnemySpentControlled?: number | null
}

export interface SgpFrameEvent {
  type?: string | null
  timestamp?: number | null
  participantId?: number | null
  killerId?: number | null
  victimId?: number | null
  assistingParticipantIds?: number[] | null
  position?: SgpFramePosition | null
  killType?: string | null
  multiKillLength?: number | null
  laneType?: string | null
  towerType?: string | null
  buildingType?: string | null
  teamId?: number | null
  monsterType?: string | null
  monsterSubType?: string | null
  levelUpType?: string | null
  skillSlot?: number | null
  itemId?: number | null
  afterId?: number | null
  beforeId?: number | null
  wardType?: string | null
  victimDamageDealt?: SgpDamageDetail[] | null
  victimDamageReceived?: SgpDamageDetail[] | null
  victimTeamfightDamageDealt?: SgpDamageDetail[] | null
  victimTeamfightDamageReceived?: SgpDamageDetail[] | null
  gameEndResult?: string | null
}

export interface SgpFrame {
  timestamp?: number | null
  events: SgpFrameEvent[]
  participantFrames: Record<number, SgpFrameParticipantStats>
}

export interface SgpDetailParticipant {
  participantId?: number | null
  puuid?: string | null
}

export interface SgpGameDetail {
  endOfGameResult?: string | null
  frameInterval?: number | null
  frames: SgpFrame[]
  participants: SgpDetailParticipant[]
}

/** SGP DETAILS 响应整体 `{ metadata?, json? }` */
export interface SgpGameDetailResponse {
  metadata?: unknown
  json?: SgpGameDetail | null
}

/** 大区选项（前端下拉用）：platformId + 中文名 */
export interface RegionOption {
  value: string
  label: string
}

/**
 * 支持跨区查询的大区列表（按官方习惯顺序）。
 * @returns 大区选项数组；失败返回空数组（头部下拉留空不影响主功能）
 */
export async function getSgpRegions(): Promise<RegionOption[]> {
  try {
    return await invoke<RegionOption[]>('get_sgp_regions')
  } catch (err) {
    console.error('[sgp] getSgpRegions failed', err)
    return []
  }
}

/**
 * 当前登录客户端所在大区的 platformId（如 `TJ100`）。
 * @returns platformId；失败返回 null
 */
export async function getCurrentSgpRegion(): Promise<string | null> {
  try {
    return await invoke<string>('get_current_sgp_region')
  } catch (err) {
    console.error('[sgp] getCurrentSgpRegion failed', err)
    return null
  }
}

/**
 * 全区按「名字#TAG」查战绩（SGP 支持无限深翻页，由调用方维护 begIndex）。
 * @returns 映射为既有 `MatchHistory` 结构（`participants[0]`=被查玩家）；失败返回 null
 */
export async function getSgpMatchHistoryByName(
  region: string,
  name: string,
  begIndex: number,
  count: number
): Promise<MatchHistory | null> {
  try {
    return await invoke<MatchHistory>('get_sgp_match_history_by_name', {
      region,
      name,
      begIndex,
      count
    })
  } catch (err) {
    console.error('[sgp] getSgpMatchHistoryByName failed', err)
    return null
  }
}

/**
 * 跨区按「名字#TAG」查玩家段位（玩家条/左栏场景）。
 *
 * Rust 侧流程：名字#TAG → RC 解析全局 puuid → 目标大区 SGP `leagues-ledge`
 * rankedStats 直查（league-session token）→ 映射为既有 `Rank` 结构。
 * 未定级/该大区无记录返回空 Rank（各队列 tier 为空，展示层显示「无段位」）。
 * @returns 段位信息；失败返回 null（保持现有降级语义）
 */
export async function getSgpRankByName(region: string, name: string): Promise<Rank | null> {
  try {
    return await invoke<Rank>('get_sgp_rank_by_name', { region, name })
  } catch (err) {
    console.error('[sgp] getSgpRankByName failed', err)
    return null
  }
}

/**
 * 跨区批量按 puuid 查段位：一次 IPC 拿整批（Rust 侧并发 + 30min 缓存兜底）。
 *
 * 跨区战绩详情页 10 人场景替代逐个 IPC；单人失败返回 null 不拖垮整批。
 * 与 LCU 版 `getRanksByPuuids` 语义对齐，但**不加前端缓存**——Rust 侧已有
 * 30min TTL，跨区场景也不是反复打开的常规路径。
 * @returns puuid → 段位信息；无数据/失败为 null；空输入返回空对象（不发请求）
 */
export async function getSgpRanksByPuuids(
  region: string,
  puuids: string[]
): Promise<Record<string, Rank | null>> {
  const unique = [...new Set(puuids.filter(Boolean))]
  if (unique.length === 0) return {}
  return invoke<Record<string, Rank | null>>('get_sgp_ranks_by_puuids', {
    region,
    puuids: unique
  })
}

/** 局级详情缓存：gameId + region → 响应（无 TTL，局数据不可变；上限防爆） */ const detailCache =
  new Map<string, SgpGameDetailResponse | Promise<SgpGameDetailResponse | null>>()
const DETAIL_CACHE_MAX = 200

/**
 * 按大区 + gameId 拉取单局 SGP 详情（帧数据/事件流/伤害明细），带局级缓存。
 *
 * 展开详情页时调用；同局重复打开（翻页回来/多开）零网络。失败不写缓存（可重试）。
 * @returns 类型化详情；失败或参数为空返回 null
 */
export async function getSgpMatchDetail(
  region: string,
  gameId: number
): Promise<SgpGameDetailResponse | null> {
  if (!region || !gameId) return null
  const key = `${region}:${gameId}`
  const cached = detailCache.get(key)
  if (cached !== undefined) return cached

  const pending = invoke<SgpGameDetailResponse>('get_sgp_match_detail', { region, gameId })
    .then(data => {
      if (detailCache.size >= DETAIL_CACHE_MAX) {
        // 简单 FIFO 淘汰：删最早的 key 腾位（Map 保持插入序）
        const first = detailCache.keys().next().value
        if (first !== undefined) detailCache.delete(first)
      }
      detailCache.set(key, data)
      return data
    })
    .catch(err => {
      console.error('[sgp] getSgpMatchDetail failed', err)
      return null as SgpGameDetailResponse | null
    })

  detailCache.set(key, pending)
  return pending
}

/**
 * 按 gameId 合并两批对局（保持 prev 时间降序，incoming 追加在尾）。
 * SGP 翻页可能重叠（重试/边界漂移），重复对局只保留先到的。
 * @returns 合并后的新数组（无 fresh 时原样返回 prev 引用）
 */
export function mergeGamesByGameId(prev: Game[], incoming: Game[]): Game[] {
  if (incoming.length === 0) return prev
  const seen = new Set(prev.map(g => g.gameId))
  const fresh = incoming.filter(g => !seen.has(g.gameId))
  return fresh.length > 0 ? [...prev, ...fresh] : prev
}

/** 全量收集（collectMode）的翻页实现签名：单测可注入替代真实 invoke */
export type SgpFetchPage = (
  region: string,
  name: string,
  begIndex: number,
  count: number
) => Promise<MatchHistory | null>

export interface SgpCollectOptions {
  region: string
  name: string
  /** 起始游标（续收场景传上次的 nextStartIndex；默认 0） */
  startIndex?: number
  /** 已收集的对局（续收/已有列表），合并结果以此为基础追加 */
  initialGames?: Game[]
  /** 每页条数，默认 50（对齐现有「收集更多」口径） */
  pageSize?: number
  /** 防失控上限，默认 500（10 页请求） */
  maxGames?: number
  /** 翻页实现，默认 getSgpMatchHistoryByName；单测注入 */
  fetchPage?: SgpFetchPage
  /** 每页合并后回调（组件用它实时刷新列表/趋势条） */
  onPage?: (merged: Game[]) => void
  /** 每轮循环前检查；返回 false 立即中断（切换玩家/卸载/手动取消） */
  shouldContinue?: () => boolean
}

export interface SgpCollectResult {
  /** 合并去重后的全部对局（时间降序） */
  games: Game[]
  /** 空批次 / 不足一页自然终止 */
  reachedEnd: boolean
  /** 因 shouldContinue=false 被取消（区别于上限截断） */
  cancelled: boolean
  /** 续收游标：已向后端请求过的场次数（不含去重，重叠页也推进） */
  nextStartIndex: number
}

/**
 * collectMode：SGP 路径全量收集（解除 LCU 50 场窗口）。
 *
 * 从 startIndex 逐页循环拉取直到：空批次终止 / 达 maxGames 截断 / shouldContinue 中断。
 * 翻页失败（fetchPage 返回 null）按已收集交付——跨区数据缺失是常态降级，不整批作废。
 * @returns 合并结果与终止原因；失败/中断时 games 为已成功收集的部分
 */
export async function collectSgpHistoryAll(opts: SgpCollectOptions): Promise<SgpCollectResult> {
  const {
    region,
    name,
    startIndex = 0,
    initialGames = [],
    pageSize = 50,
    maxGames = 500,
    fetchPage = getSgpMatchHistoryByName,
    onPage,
    shouldContinue
  } = opts

  let games = initialGames
  let begIndex = startIndex
  while (games.length < maxGames) {
    if (shouldContinue && !shouldContinue()) {
      return { games, reachedEnd: false, cancelled: true, nextStartIndex: begIndex }
    }
    const mh = await fetchPage(region, name, begIndex, pageSize)
    if (!mh) break
    const incoming = mh.games?.games ?? []
    const merged = mergeGamesByGameId(games, incoming)
    const added = merged.length - games.length
    games = merged
    if (incoming.length < pageSize || incoming.length === 0 || added === 0) {
      // 不足一页 / 空批次 = 已到末尾；全重复页 = 数据源异常，防死循环同样终止
      return {
        games,
        reachedEnd: true,
        cancelled: false,
        nextStartIndex: begIndex + incoming.length
      }
    }
    begIndex += incoming.length
    onPage?.(games)
  }
  return { games, reachedEnd: false, cancelled: false, nextStartIndex: begIndex }
}
