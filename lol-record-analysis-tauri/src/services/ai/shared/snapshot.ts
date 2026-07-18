/**
 * 把原始 Game 对象转换为面向 LLM 友好的快照结构。
 *
 * 相对现状新增字段：
 * - 顶层：modeContext（替代旧的 augmentMode bool）
 * - 每玩家：teamPosition / lane / role / dpm / gpm / csm /
 *           items / trinketId / summonerSpells / wardScore /
 *           multiKills / recentProfile
 */

import type {
  Game,
  MatchPlayerIdentity,
  Participant,
  ParticipantStats
} from '@renderer/types/domain/match'
import { getChampionName } from '../champion-names'
import { classifyMode } from './modeContext'
import { inferTeamPosition } from './positionInfer'
import { spellIdsToNames } from './summonerSpells'
import type { ModeContext, RecentPlayerProfile, TeamPosition } from './types'

function getParticipants(game: Game): Participant[] {
  return game.gameDetail?.participants?.length ? game.gameDetail.participants : game.participants
}

function getParticipantIdentities(game: Game): MatchPlayerIdentity[] {
  return game.gameDetail?.participantIdentities?.length
    ? game.gameDetail.participantIdentities
    : game.participantIdentities
}

function buildDisplayName(identity: MatchPlayerIdentity | undefined, fallbackId: number) {
  if (!identity) return `玩家${fallbackId}`
  return `${identity.player.gameName}#${identity.player.tagLine}`
}

function getCurrentPlayerKey(game: Game) {
  const current = game.participantIdentities?.[0]?.player
  if (!current) return ''
  return `${current.gameName}#${current.tagLine}`
}

function getAugmentIds(stats: ParticipantStats) {
  return [
    stats.playerAugment1,
    stats.playerAugment2,
    stats.playerAugment3,
    stats.playerAugment4,
    stats.playerAugment5,
    stats.playerAugment6
  ].filter(id => id > 0)
}

function getItemIds(stats: ParticipantStats): number[] {
  // items 0-5 are the 6 main item slots; item6 is the trinket
  return [stats.item0, stats.item1, stats.item2, stats.item3, stats.item4, stats.item5]
}

export function isAugmentMode(game: Game) {
  return (
    game.gameMode === 'CHERRY' ||
    game.queueId === 2400 ||
    game.queueId === 1700 ||
    /斗魂竞技场|海克斯乱斗/.test(game.queueName || '')
  )
}

function roundStat(value: number, digits: number = 1) {
  return Number(value.toFixed(digits))
}

function totalCs(stats: ParticipantStats) {
  return stats.totalMinionsKilled + stats.neutralMinionsKilled
}

function kda(stats: ParticipantStats) {
  return (stats.kills + stats.assists) / Math.max(1, stats.deaths)
}

function percentOf(value: number, total: number) {
  if (total <= 0) return 0
  return roundStat((value / total) * 100)
}

function safePerMinute(value: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0
  const minutes = durationSeconds / 60
  return roundStat(value / minutes, 1)
}

function readTeamPosition(participant: Participant): TeamPosition {
  // LCU 战绩常整局缺 teamPosition/timeline.lane（国服真机实测 10 人全缺）——
  // 有值时透传，缺失时用召唤师技能+英雄启发式推断（惩戒→打野等），
  // 推不出再落 UNKNOWN（消费方按无分路降级）。
  return inferTeamPosition({
    teamPosition: (participant as any).teamPosition ?? '',
    spellIds: [participant.spell1Id, participant.spell2Id],
    championId: participant.championId
  })
}

export function buildMatchSnapshot(
  game: Game,
  profileMap?: Map<string, RecentPlayerProfile | null>
) {
  const participants = getParticipants(game)
  const identities = getParticipantIdentities(game)
  const currentPlayerKey = getCurrentPlayerKey(game)
  const modeContext: ModeContext = classifyMode(game.queueId, game.gameMode)
  const durationSeconds = game.gameDuration

  const teamTotals = new Map<
    number,
    { damage: number; taken: number; gold: number; kills: number }
  >()
  for (const participant of participants) {
    const current = teamTotals.get(participant.teamId) ?? {
      damage: 0,
      taken: 0,
      gold: 0,
      kills: 0
    }
    current.damage += participant.stats.totalDamageDealtToChampions
    current.taken += participant.stats.totalDamageTaken
    current.gold += participant.stats.goldEarned
    current.kills += participant.stats.kills
    teamTotals.set(participant.teamId, current)
  }

  const players = participants.map((participant, index) => {
    const identity = identities[participant.participantId - 1] ?? identities[index]
    const displayName = buildDisplayName(identity, participant.participantId)
    const totals = teamTotals.get(participant.teamId) ?? {
      damage: 0,
      taken: 0,
      gold: 0,
      kills: 0
    }
    const stats = participant.stats
    const tl = (participant as any).timeline ?? {}
    const puuid = identity?.player?.puuid ?? ''

    return {
      participantId: participant.participantId,
      teamId: participant.teamId,
      name: displayName,
      champion: getChampionName(participant.championId),
      isMe: displayName === currentPlayerKey,
      win: stats.win,
      kda: roundStat(kda(stats), 2),
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      gold: stats.goldEarned,
      cs: totalCs(stats),
      damage: stats.totalDamageDealtToChampions,
      taken: stats.totalDamageTaken,
      heal: stats.totalHeal,
      turretDamage: stats.damageDealtToTurrets,
      damageShare: percentOf(stats.totalDamageDealtToChampions, totals.damage),
      damageTakenShare: percentOf(stats.totalDamageTaken, totals.taken),
      goldShare: percentOf(stats.goldEarned, totals.gold),
      killParticipation: percentOf(stats.kills + stats.assists, Math.max(totals.kills, 1)),
      perks: {
        primary: stats.perk0,
        subStyle: stats.perkSubStyle
      },
      augments: getAugmentIds(stats),

      // NEW fields
      teamPosition: readTeamPosition(participant),
      lane: tl.lane ?? '',
      role: tl.role ?? '',
      summonerSpells: spellIdsToNames([participant.spell1Id, participant.spell2Id]),
      dpm: safePerMinute(stats.totalDamageDealtToChampions, durationSeconds),
      gpm: safePerMinute(stats.goldEarned, durationSeconds),
      csm: safePerMinute(totalCs(stats), durationSeconds),
      items: modeContext.hasItemBuild ? getItemIds(stats) : [],
      trinketId: (stats as any).item6 ?? 0,
      // 视野三项：国服 LCU 战绩实测不下发这些字段——缺失必须是 null 而非 0，
      // 否则模型会拿假 0 冤枉玩家"整局没插眼"（真机复现）。
      wardScore: (stats as any).visionScore ?? null,
      controlWardsPlaced: (stats as any).sightWardsBoughtInGame ?? null,
      visionWardsBought: (stats as any).visionWardsBoughtInGame ?? null,
      // 多杀字段已在类型上声明（后端曾丢弃该字段导致这里恒为 0，现已透传）
      multiKills: {
        double: stats.doubleKills ?? 0,
        triple: stats.tripleKills ?? 0,
        quadra: stats.quadraKills ?? 0,
        penta: stats.pentaKills ?? 0
      },
      recentProfile: profileMap?.get(puuid) ?? null
    }
  })

  const teams = [...new Set(players.map(p => p.teamId))]
    .map(teamId => {
      const teamPlayers = players.filter(p => p.teamId === teamId)
      return {
        teamId,
        result: teamPlayers[0]?.win ? '胜方' : '败方',
        totalKills: teamPlayers.reduce((s, p) => s + p.kills, 0),
        totalDeaths: teamPlayers.reduce((s, p) => s + p.deaths, 0),
        totalAssists: teamPlayers.reduce((s, p) => s + p.assists, 0),
        totalDamage: teamPlayers.reduce((s, p) => s + p.damage, 0),
        totalTaken: teamPlayers.reduce((s, p) => s + p.taken, 0),
        totalGold: teamPlayers.reduce((s, p) => s + p.gold, 0),
        players: [...teamPlayers].sort((a, b) => a.participantId - b.participantId)
      }
    })
    .sort((a, b) => Number(b.players[0]?.win ?? false) - Number(a.players[0]?.win ?? false))

  return {
    gameId: game.gameId,
    queueName: game.queueName,
    queueId: game.queueId,
    gameMode: game.gameMode,
    durationSeconds,
    modeContext,
    teams,
    players
  }
}

export type MatchSnapshot = ReturnType<typeof buildMatchSnapshot>
