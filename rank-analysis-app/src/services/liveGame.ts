/**
 * 对局中实时数据访问（Live Client Data API）
 *
 * 对应 Rust command get_live_game_data（lcu/api/live_game.rs）。liveclientdata
 * 只在对局内可用：不在对局中返回 null 是正常状态，调用方按「无实时数据」降级。
 *
 * 注意事件/装备字段的 key 是 PascalCase（EventName/itemID），与 players 的
 * camelCase 不同源——这是 Rust 侧逐字段 rename 后原样透传的，别"顺手"改成 camelCase。
 */

import { invoke } from '@tauri-apps/api/core'

export interface LiveScore {
  assists: number
  creepScore: number
  deaths: number
  kills: number
  wardScore: number
}

export interface LiveItem {
  /** liveclientdata 原始 key 为 PascalCase itemID */
  itemID: number
  itemCount: number
}

export interface LiveGold {
  total: number
}

export interface LivePlayer {
  championName: string
  position: string
  /** 'ORDER' / 'CHAOS' */
  team: string
  isDead: boolean
  summonerName: string
  level: number
  items: LiveItem[]
  scores: LiveScore
  gold: LiveGold
}

export interface LiveEvent {
  /** EventName: ChampionKill / DragonKill / BaronKill / TurretKilled / GameStart ... */
  eventName: string
  eventTime: number
  killerName: string
  victimName: string
  dragonType?: string | null
  towerName?: string | null
  assisters: string[]
}

export interface LiveGameData {
  gameMode: string
  gameTime: number
}

export interface LiveGameSnapshot {
  gameTime: number
  players: LivePlayer[]
  events: LiveEvent[]
  gameData: LiveGameData
}

/**
 * 获取对局中实时快照。
 *
 * @returns 对局中时返回快照；不在对局中 / Live Client 不可用时返回 null
 */
export async function getLiveGameData(): Promise<LiveGameSnapshot | null> {
  try {
    const result = await invoke<LiveGameSnapshot | null>('get_live_game_data')
    return result
  } catch (error) {
    console.warn('[liveGame] getLiveGameData failed:', error)
    return null
  }
}
