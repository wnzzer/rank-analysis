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
import type { MatchHistory } from '@renderer/types/domain/match'

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

/** 局级详情缓存：gameId + region → 响应（无 TTL，局数据不可变；上限防爆） */
const detailCache = new Map<string, SgpGameDetailResponse | Promise<SgpGameDetailResponse | null>>()
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
