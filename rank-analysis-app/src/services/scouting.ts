/**
 * 赛前威胁评级（M4 战场六）：从 champ-select 会话获取敌方玩家威胁评级。
 *
 * 每条评级包含威胁等级、风格标签、相遇次数、对线侵略性、近期表现分等。
 * 敌方数据不足时降级为 Low + caveats。
 */

import { invoke } from '@tauri-apps/api/core'

/** 威胁等级（与 Rust ThreatLevel 对齐，camelCase） */
export type ThreatLevel = 'Low' | 'Medium' | 'High' | 'Critical'

/** 单名敌方玩家威胁评级（与 Rust ThreatRating 对齐，camelCase） */
export interface ThreatRating {
  threatLevel: ThreatLevel
  styleTags: string[]
  encounterCount: number
  laneAggression: number
  recentPerformance: number
  mainChampionWinRate: number | null
  caveats: string[]
  puuid: string
  position: string
}

/** 威胁等级 → 中文标签 */
export const THREAT_LEVEL_LABELS: Record<ThreatLevel, string> = {
  Low: '低威胁',
  Medium: '中等',
  High: '高威胁',
  Critical: '极高威胁'
}

/** 威胁等级 → 颜色 */
export const THREAT_LEVEL_COLORS: Record<ThreatLevel, string> = {
  Low: '#4ade80',
  Medium: '#facc15',
  High: '#f97316',
  Critical: '#ef4444'
}

/** 从当前 champ-select 会话获取敌方玩家威胁评级 */
export async function getThreatRatings(): Promise<ThreatRating[]> {
  return await invoke<ThreatRating[]>('get_threat_ratings')
}
