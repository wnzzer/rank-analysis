/**
 * 打野抓人节奏（Gank Pattern）客户端
 *
 * 对应 Rust command `get_jungle_gank_pattern`（command/gank_pattern.rs，SGP DETAILS
 * 帧事件 → 目标玩家前 10 分钟参与击杀）。本文件负责：
 * - invoke 薄封装 + LRU 缓存 + 并发去重（敌方打野多次触发只打一次 SGP）
 * - victim 英雄按 OP.GG 主分路归路（抓下 = 击杀发生在下路英雄身上）
 * - 聚合成人类可读提示行（UI 与 AI prompt 共用）
 *
 * 降级约定：取数失败 / 样本不足（打野局 < 3，Rust 侧返回 null）一律返回 null，
 * 消费方静默隐藏——行为模式数据不足时不制造噪音。
 */

import { invoke } from '@tauri-apps/api/core'

/** Rust `GankPatternRaw` 的 camelCase 镜像（单条击杀事件） */
export interface GankKillEventRaw {
  timestampMs: number
  victimChampionId: number
}

/** Rust `GankPatternRaw` 的 camelCase 镜像 */
export interface GankPatternRaw {
  analyzedGames: number
  jungleGames: number
  firstKillMs: number | null
  killEvents: GankKillEventRaw[]
}

/** 归路维度（victim 英雄 → 所在路；辅助击杀并入下路） */
export type GankLaneKey = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'OTHER'

/** 聚合后的展示结构 */
export interface GankPatternSummary {
  /** 分析到的打野局数（样本量，供文案与可信度展示） */
  jungleGames: number
  /** 前 10 分钟参与击杀总数（victim 可归类的） */
  totalKills: number
  /** 最早一次参与击杀的毫秒时间；无击杀为 null */
  firstKillMs: number | null
  /** victim 位置分布 */
  laneDistribution: Partial<Record<GankLaneKey, number>>
  /** 占比最高且 ≥2 次、占比 ≥60% 的 lane（有明确倾向才输出，否则 null） */
  topLane: GankLaneKey | null
  topLaneRatio: number | null
}

/** OP.GG 英雄主分路 → 归路；辅助视为下路（抓辅助也属于下路冲突） */
const LANE_BY_POSITION: Record<string, GankLaneKey> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MIDDLE',
  BOTTOM: 'BOTTOM',
  UTILITY: 'BOTTOM'
}

/** 明确倾向阈值：占比 ≥60% 且 ≥2 次才算「他喜欢抓这一路」 */
const TOP_LANE_RATIO_THRESHOLD = 60

/**
 * 把 Rust 原始击杀事件聚合成展示结构。
 *
 * @param raw - Rust 返回的原始统计
 * @param positionOf - championId → OP.GG 主分路（undefined/未知英雄计入 OTHER）
 *
 * 纯函数幂等：UI 与 AI prompt 复用同一份口径（victim 归类）。
 */
export function aggregateGankPattern(
  raw: GankPatternRaw,
  positionOf: (championId: number) => string | undefined
): GankPatternSummary {
  const laneDistribution: Partial<Record<GankLaneKey, number>> = {}
  let totalKills = 0
  for (const ev of raw.killEvents) {
    // victim 0 = 摘要里找不到该 participantId 的英雄（异常局），跳过不稀释统计
    if (ev.victimChampionId <= 0) continue
    const pos = positionOf(ev.victimChampionId)?.toUpperCase()
    const lane = (pos ? LANE_BY_POSITION[pos] : undefined) ?? 'OTHER'
    laneDistribution[lane] = (laneDistribution[lane] ?? 0) + 1
    totalKills += 1
  }
  let topLane: GankLaneKey | null = null
  let topLaneRatio: number | null = null
  if (totalKills > 0) {
    const best = Object.entries(laneDistribution).sort((a, b) => b[1] - a[1])[0]
    if (best) {
      const ratio = Math.round((best[1] / totalKills) * 100)
      if (best[1] >= 2 && ratio >= TOP_LANE_RATIO_THRESHOLD) {
        topLane = best[0] as GankLaneKey
        topLaneRatio = ratio
      }
    }
  }
  return {
    jungleGames: raw.jungleGames,
    totalKills,
    firstKillMs: raw.firstKillMs,
    laneDistribution,
    topLane,
    topLaneRatio
  }
}

const GANK_LANE_LABEL: Record<GankLaneKey, string> = {
  TOP: '上路',
  JUNGLE: '野区',
  MIDDLE: '中路',
  BOTTOM: '下路',
  OTHER: '其他'
}

/** 毫秒 → `m:ss`（如 250000 → 4:10） */
function formatKillTime(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 人类可读提示行（不含玩家名——prompt 玩家上下文已点名，避免重复噪音）。
 * 分布按次数降序取前 3 路，附占比；无击杀时给「节奏偏慢」结论。
 */
export function formatGankPatternLine(summary: GankPatternSummary): string {
  if (summary.totalKills === 0) {
    return `敌方打野近 ${summary.jungleGames} 局前 10 分钟无参与击杀（前期节奏偏慢）`
  }
  const lanes = Object.entries(summary.laneDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lane, n]) => {
      const pct = Math.round((n / summary.totalKills) * 100)
      return `${GANK_LANE_LABEL[lane as GankLaneKey] ?? lane} ${pct}%（${n}次）`
    })
    .join('、')
  const firstKill =
    summary.firstKillMs != null ? `，首杀 ${formatKillTime(summary.firstKillMs)}` : ''
  return `敌方打野近 ${summary.jungleGames} 局前 10 分钟参与击杀 ${summary.totalKills} 次：${lanes}${firstKill}`
}

const CACHE = new Map<string, GankPatternRaw>()
const INFLIGHT = new Map<string, Promise<GankPatternRaw | null>>()
const CACHE_MAX = 50

/**
 * 拉取敌方打野抓人节奏（SGP 路径；敌方 LCU 无数据，SGP 是唯一可行源）。
 *
 * 缓存 key = `region:puuid|name`；同一目标并发请求去重（选人期防抖期间重复
 * compute 只发一次）。任何失败返回 null（调用方静默隐藏）。
 */
export async function fetchJungleGankPattern(params: {
  region: string
  puuid?: string
  name?: string
}): Promise<GankPatternRaw | null> {
  const key = `${params.region}:${params.puuid ?? params.name ?? ''}`
  const cached = CACHE.get(key)
  if (cached) return cached
  const inflight = INFLIGHT.get(key)
  if (inflight) return inflight
  const p = (async () => {
    try {
      const raw = await invoke<GankPatternRaw | null>('get_jungle_gank_pattern', {
        region: params.region,
        puuid: params.puuid ?? null,
        name: params.name ?? null
      })
      if (raw) {
        CACHE.set(key, raw)
        if (CACHE.size > CACHE_MAX) {
          const oldest = CACHE.keys().next().value
          if (oldest) CACHE.delete(oldest)
        }
      }
      return raw
    } catch (error) {
      console.warn('[gankPattern] fetch failed:', error)
      return null
    } finally {
      INFLIGHT.delete(key)
    }
  })()
  INFLIGHT.set(key, p)
  return p
}
