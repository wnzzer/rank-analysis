/**
 * 评分相关单测的共用构造器：10 人对局、一条单杀时间线、空基准数据（全部走本局相对比较）。
 */
import type { Game } from '@renderer/types/domain/match'
import type { ScoringData } from '../scoring/scorePlayers'
import type { SlimTimeline } from '../timeline'

const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

/** 空基准 + 空阈值：所有指标退回本局相对统计，阈值退回 DEFAULT_THRESHOLD */
export const EMPTY_SCORING_DATA: ScoringData = {
  baseline: {
    meta: { builtAt: '', versions: [], sampleGames: 0, detailsGames: 0, perQueue: {}, note: '' },
    cells: {}
  },
  thresholds: { meta: { builtAt: '', sampleGames: 0 }, cells: {} }
}

/** 10 人：1-5 蓝方胜、6-10 红方，按上野中下辅 */
export function makeScoringGame(): Game {
  const ids = Array.from({ length: 10 }, (_, i) => i + 1)
  return {
    gameId: 7,
    queueId: 420,
    queueName: '单双排',
    gameMode: 'CLASSIC',
    mapId: 11,
    gameDuration: 1800,
    participants: ids.map(id => ({
      participantId: id,
      teamId: id <= 5 ? 100 : 200,
      championId: id,
      spell1Id: 4,
      spell2Id: id % 5 === 2 ? 11 : 14,
      teamPosition: POS[(id - 1) % 5],
      stats: {
        win: id <= 5,
        kills: id,
        deaths: 11 - id,
        assists: 5,
        totalDamageDealtToChampions: 10000 + id * 1000,
        totalDamageTaken: 15000,
        goldEarned: 9000 + id * 300,
        totalMinionsKilled: 150,
        neutralMinionsKilled: id % 5 === 2 ? 120 : 5,
        totalHeal: 500,
        damageDealtToTurrets: 1000,
        damageDealtToObjectives: id * 1000,
        timeCCingOthers: id * 2,
        visionScore: 20,
        item6: 3340
      },
      timeline: { lane: POS[(id - 1) % 5], role: 'NONE' }
    })),
    participantIdentities: ids.map(id => ({
      participantId: id,
      player: { gameName: `玩家${id}`, tagLine: '0000', puuid: `puuid-${id}` }
    }))
  } as unknown as Game
}

export function makeScoringTimeline(): SlimTimeline {
  const players = (t: number) =>
    Array.from({ length: 10 }, (_, i) => ({
      participantId: i + 1,
      totalGold: 500 + t,
      xp: 0,
      level: 1,
      cs: 0,
      jungleCs: 0,
      x: 7000,
      y: 7000,
      damageToChampions: 0
    }))
  return {
    gameId: 7,
    frameIntervalMs: 60000,
    participants: [],
    frames: [
      { timestamp: 0, players: players(0) },
      { timestamp: 600000, players: players(1) }
    ],
    events: [
      {
        type: 'CHAMPION_KILL',
        timestamp: 300000,
        killerId: 1,
        victimId: 6,
        assisting: [],
        x: 1000,
        y: 10000,
        bounty: 300,
        shutdownBounty: 0,
        damageReceived: []
      }
    ],
    items: {}
  }
}
