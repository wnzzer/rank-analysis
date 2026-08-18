/**
 * 确定性评分层前端封装（Rust 侧实现 Akari 式 17 分制，参考 src-tauri/src/command/score.rs）。
 *
 * 纪律：评分是程序确定性计算的事实（无 LLM），前端只负责 invoke 与组装输入；
 * 输入数据全在页面已有（LCU Game / SGP 局），因此 compute 路径零网络 IO（纯计算秒出）。
 */

import { invoke } from '@tauri-apps/api/core'
import type { Game, Participant } from '@renderer/types/domain/match'

/** 9 维明细（camelCase 与 Rust `PlayerScoreBreakdown` 对齐） */
export interface PlayerScoreBreakdown {
  kda: number
  win: number
  damage: number
  damageTaken: number
  heal: number
  cs: number
  gold: number
  participation: number
  vision: number
}

/** 单名玩家的确定性评分（17 分制） */
export interface PlayerScore {
  participantId: number
  championId: number
  teamId: number
  puuid: string
  summonerName: string
  win: boolean
  total: number
  breakdown: PlayerScoreBreakdown
}

/** 评分输入（camelCase 与 Rust `PlayerScoreInput` 对齐） */
export interface PlayerScoreInput {
  participantId: number
  championId: number
  teamId: number
  puuid?: string
  summonerName?: string
  win: boolean
  kills: number
  deaths: number
  assists: number
  goldEarned: number
  damageDealtToChampions: number
  damageTaken: number
  totalHeal: number
  /** 总补刀 = 小兵 + 野怪 */
  cs: number
  visionScore: number
  /** 对局时长（秒） */
  gameDuration: number
}

/** 总分 17 的色阶语义（供 UI 使用） */
export const PLAYER_SCORE_MAX = 17

/** 由 LCU `Game`（gameDetail.participants 优先）组装 10 人评分输入 */
export function buildScoreInputsFromGame(game: Game): PlayerScoreInput[] {
  const participants =
    game.gameDetail?.participants?.length > 0 ? game.gameDetail.participants : game.participants
  const identities =
    game.gameDetail?.participantIdentities?.length > 0
      ? game.gameDetail.participantIdentities
      : game.participantIdentities

  return participants.map((p, index) => {
    const identity = identities[p.participantId - 1] ?? identities[index]
    const stats = p.stats ?? ({} as Participant['stats'])
    return {
      participantId: p.participantId,
      championId: p.championId,
      teamId: p.teamId,
      puuid: identity?.player?.puuid ?? '',
      summonerName: identity ? `${identity.player.gameName}#${identity.player.tagLine}` : '',
      win: stats.win,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      goldEarned: stats.goldEarned,
      damageDealtToChampions: stats.totalDamageDealtToChampions,
      damageTaken: stats.totalDamageTaken,
      totalHeal: stats.totalHeal,
      cs: stats.totalMinionsKilled + stats.neutralMinionsKilled,
      visionScore: stats.visionScore ?? 0,
      gameDuration: game.gameDuration
    }
  })
}

/** 纯计算出分（Rust 侧无 IO；失败抛出由调用方降级） */
export async function computePlayerScores(inputs: PlayerScoreInput[]): Promise<PlayerScore[]> {
  return invoke<PlayerScore[]>('compute_player_scores', { inputs })
}

/** 按 LCU 对局 ID 出分（Rust 侧 moka 缓存；失败返回 null 供静默降级） */
export async function fetchPlayerScoresByGameId(gameId: number): Promise<PlayerScore[] | null> {
  try {
    return await invoke<PlayerScore[]>('get_player_scores', { gameId })
  } catch (err) {
    console.warn('[score] get_player_scores failed', err)
    return null
  }
}

/** 便捷：由 Game 对象直接出分（组装 + 纯计算，秒出） */
export async function scoreGame(game: Game): Promise<PlayerScore[] | null> {
  try {
    return await computePlayerScores(buildScoreInputsFromGame(game))
  } catch (err) {
    console.warn('[score] compute_player_scores failed', err)
    return null
  }
}

/** 分数排序（从高到低，总分相同按 participantId 保证确定性） */
export function sortScoresDesc(scores: PlayerScore[]): PlayerScore[] {
  return [...scores].sort((a, b) => b.total - a.total || a.participantId - b.participantId)
}
