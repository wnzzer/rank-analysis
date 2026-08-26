/**
 * Mayhem（海克斯大乱斗 queueId 2400）数据服务
 *
 * 封装 Rust 侧 mayhem 数据同步与读取命令（src-tauri/src/command/mayhem.rs）。
 * 数据源：aramgg 公开客户端 API，版本化 JSON 落地临时目录、本地优先读取。
 *
 * 数据契约（2026-08-26 实测钉死）：
 * - champions.json → { champions: MayhemChampion[] }
 * - augments.json / champion-shards/* → 结构由上游演进，按原始 Value 透传
 */

import { invoke } from '@tauri-apps/api/core'

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

/** 读取强化榜原始 JSON（结构随上游演进，透传处理） */
export async function getMayhemAugments(): Promise<Record<string, unknown>> {
  return (await invoke('mayhem_get_augments')) as Record<string, unknown>
}

/** 读取单英雄大乱斗详情；null 表示未同步或该英雄无数据 */
export async function getMayhemChampionDetail(
  championId: number
): Promise<Record<string, unknown> | null> {
  return (await invoke('mayhem_get_champion_detail', {
    championId
  })) as Record<string, unknown> | null
}
