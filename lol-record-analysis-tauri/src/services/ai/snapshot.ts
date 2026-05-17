/**
 * 将原始 Game 对象转换为"面向 LLM 友好的快照结构"
 * 所有 percent/占比/所属队伍聚合都在这里算好
 */

import type {
  Game,
  MatchPlayerIdentity,
  Participant,
  ParticipantStats
} from '@renderer/types/domain/match'
import { getChampionName } from './champion-names'

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

export function isAugmentMode(game: Game) {
  return (
    game.gameMode === 'CHERRY' ||
    game.queueId === 2400 ||
    /斗魂竞技场|海克斯乱斗|海克斯大乱斗/.test(game.queueName || '')
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

export function buildMatchSnapshot(game: Game) {
  const participants = getParticipants(game)
  const identities = getParticipantIdentities(game)
  const currentPlayerKey = getCurrentPlayerKey(game)

  const teamTotals = new Map<
    number,
    { damage: number; taken: number; gold: number; kills: number }
  >()
  for (const participant of participants) {
    const current = teamTotals.get(participant.teamId) ?? { damage: 0, taken: 0, gold: 0, kills: 0 }
    current.damage += participant.stats.totalDamageDealtToChampions
    current.taken += participant.stats.totalDamageTaken
    current.gold += participant.stats.goldEarned
    current.kills += participant.stats.kills
    teamTotals.set(participant.teamId, current)
  }

  const players = participants.map((participant, index) => {
    const identity = identities[participant.participantId - 1] ?? identities[index]
    const displayName = buildDisplayName(identity, participant.participantId)
    const totals = teamTotals.get(participant.teamId) ?? { damage: 0, taken: 0, gold: 0, kills: 0 }

    return {
      participantId: participant.participantId,
      teamId: participant.teamId,
      name: displayName,
      champion: getChampionName(participant.championId),
      spellIds: [participant.spell1Id, participant.spell2Id],
      isMe: displayName === currentPlayerKey,
      win: participant.stats.win,
      kda: roundStat(kda(participant.stats), 2),
      kills: participant.stats.kills,
      deaths: participant.stats.deaths,
      assists: participant.stats.assists,
      gold: participant.stats.goldEarned,
      cs: totalCs(participant.stats),
      damage: participant.stats.totalDamageDealtToChampions,
      taken: participant.stats.totalDamageTaken,
      heal: participant.stats.totalHeal,
      turretDamage: participant.stats.damageDealtToTurrets,
      damageShare: percentOf(participant.stats.totalDamageDealtToChampions, totals.damage),
      damageTakenShare: percentOf(participant.stats.totalDamageTaken, totals.taken),
      goldShare: percentOf(participant.stats.goldEarned, totals.gold),
      killParticipation: percentOf(
        participant.stats.kills + participant.stats.assists,
        Math.max(totals.kills, 1)
      ),
      perks: {
        primary: participant.stats.perk0,
        subStyle: participant.stats.perkSubStyle
      },
      augments: getAugmentIds(participant.stats)
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
    durationSeconds: game.gameDuration,
    augmentMode: isAugmentMode(game),
    teams,
    players
  }
}

export type MatchSnapshot = ReturnType<typeof buildMatchSnapshot>
