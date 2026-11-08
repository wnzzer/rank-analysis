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
import { attributeDeaths, type AttributedDeath } from './scoring/deathAttribution'
import { timelineMetrics, type TimelineMetricValues } from './scoring/metrics'
import { computeVsLaneOpponent } from './laneFacts'
import { classifyMode } from './modeContext'
import {
  buildTeamContext,
  buildTimelineCards,
  type PlayerTeamContext,
  type SlimTimeline,
  type TimelineCard
} from './timeline'
import { inferTeamPosition } from './positionInfer'
import { assignTeamPositions } from './positionAssign'
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

/**
 * 分路解析:有分路模式且整队恰 5 人时整队求解(选秀队列按 participantId 槽位,
 * 否则吃野/补刀等强信号排除法,见 positionAssign)——逐人启发式对上单/非典型辅助推不出,
 * 会让 stage1 的辅助保护规则与对位比较失效(真机实测一局错 4 人)。
 * LCU 下发了真实 teamPosition 的成员始终透传优先；SGP 真值（truthPositionMap）又优先于本函数结果。
 * @returns participantId → 推断分路;不满足排除法条件的成员不在 map 中
 */
function buildTeamPositionMap(
  participants: Participant[],
  hasLanes: boolean,
  queueId: number
): Map<number, TeamPosition> {
  const map = new Map<number, TeamPosition>()
  if (!hasLanes) return map

  const byTeam = new Map<number, Participant[]>()
  for (const p of participants) {
    const list = byTeam.get(p.teamId) ?? []
    list.push(p)
    byTeam.set(p.teamId, list)
  }

  for (const team of byTeam.values()) {
    if (team.length !== 5) continue
    const assigned = assignTeamPositions(
      team.map(p => ({
        championId: p.championId,
        spellIds: [p.spell1Id, p.spell2Id],
        minionsKilled: p.stats.totalMinionsKilled ?? 0,
        jungleMinionsKilled: p.stats.neutralMinionsKilled ?? 0,
        participantId: p.participantId
      })),
      queueId
    )
    team.forEach((p, i) => {
      // 真实 teamPosition 优先于排除法结果
      const real = (p as any).teamPosition
      if (
        real === 'TOP' ||
        real === 'JUNGLE' ||
        real === 'MIDDLE' ||
        real === 'BOTTOM' ||
        real === 'UTILITY'
      ) {
        map.set(p.participantId, real)
      } else {
        map.set(p.participantId, assigned[i])
      }
    })
  }
  return map
}

const TRUTH_POSITIONS: ReadonlySet<string> = new Set([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'UTILITY'
])

/**
 * SGP 单局 SUMMARY 的真实分路（时间线 participants 已由 remapTimeline 按 puuid 改写为 LCU 编号）。
 * 本地 LCU 战绩没有可信分路，推断会把中单/下路互换（真机局复现）；有真值时一律以真值为准。
 * @returns participantId → 分路；无分路模式、无时间线、值为空/非法时不收
 */
function truthPositionMap(
  timeline: SlimTimeline | null | undefined,
  hasLanes: boolean
): Map<number, TeamPosition> {
  const out = new Map<number, TeamPosition>()
  if (!timeline || !hasLanes) return out
  for (const p of timeline.participants) {
    const pos = p.teamPosition ?? ''
    if (p.participantId > 0 && TRUTH_POSITIONS.has(pos))
      out.set(p.participantId, pos as TeamPosition)
  }
  return out
}

/** 时间线（已 remap 到 LCU participantId）里的 SGP 终局指标，按 pid 索引 */
function sgpScoringInputs(timeline: SlimTimeline | null | undefined) {
  return new Map((timeline?.participants ?? []).map(p => [p.participantId, p]))
}

export function buildMatchSnapshot(
  game: Game,
  profileMap?: Map<string, RecentPlayerProfile | null>,
  timeline?: SlimTimeline | null
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

  const teamPositionMap = buildTeamPositionMap(participants, modeContext.hasLanes, game.queueId)
  const truthPositions = truthPositionMap(timeline, modeContext.hasLanes)
  const sgpInputs = sgpScoringInputs(timeline)

  const basePlayers = participants.map((participant, index) => {
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
      championId: participant.championId,
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
      teamPosition:
        truthPositions.get(participant.participantId) ??
        teamPositionMap.get(participant.participantId) ??
        readTeamPosition(participant),
      lane: tl.lane ?? '',
      role: tl.role ?? '',
      summonerSpells: spellIdsToNames([participant.spell1Id, participant.spell2Id]),
      dpm: safePerMinute(stats.totalDamageDealtToChampions, durationSeconds),
      gpm: safePerMinute(stats.goldEarned, durationSeconds),
      csm: safePerMinute(totalCs(stats), durationSeconds),
      items: modeContext.hasItemBuild ? getItemIds(stats) : [],
      trinketId: (stats as any).item6 ?? 0,
      // 评分用终局指标：缺失为 null（旧缓存/非 gameDetail 来源）
      // 基准取自 SGP SUMMARY，故优先用时间线携带的 SGP 值；其次 LCU；都没有为 null
      objectiveDamage:
        sgpInputs.get(participant.participantId)?.damageDealtToObjectives ??
        stats.damageDealtToObjectives ??
        null,
      ccSeconds:
        sgpInputs.get(participant.participantId)?.timeCCingOthers ?? stats.timeCCingOthers ?? null,
      // 视野三项：国服 LCU 战绩实测不下发这些字段——缺失必须是 null 而非 0，
      // 否则模型会拿假 0 冤枉玩家"整局没插眼"（真机复现）。
      wardScore:
        sgpInputs.get(participant.participantId)?.visionScore ?? (stats as any).visionScore ?? null,
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

  // 终局对位差值：TS 预算好（见 laneFacts.ts），供名册对位段与张冠李戴过滤的「本人数字」使用。
  // 分路已含 SGP 真值（truthPositions 优先），推断只是兜底。无分路模式一律 null——
  // 大乱斗的 LCU lane 字段仍可能有值，不能据此拼对位
  const players = basePlayers.map(p => ({
    ...p,
    vsLaneOpponent: modeContext.hasLanes ? computeVsLaneOpponent(p, basePlayers) : null
  }))

  // 时间线事实卡片（spec §2）：players 是 RosterPlayer 的结构超集，直接作名册。
  const cardInput = timeline
    ? {
        tl: timeline,
        roster: players,
        hasLanes: modeContext.hasLanes,
        hasItemBuild: modeContext.hasItemBuild,
        mapId: game.mapId
      }
    : null
  const timelineCards: TimelineCard[] | null = cardInput ? buildTimelineCards(cardInput) : null

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
    /** 地图（11 召唤师峡谷 / 12 嚎哭深渊 / 30 斗魂竞技场）：区域名与小地图换算用 */
    mapId: game.mapId,
    durationSeconds,
    modeContext,
    teams,
    players,
    timeline: (cardInput && timelineCards?.length
      ? (() => {
          const deaths = attributeDeaths(cardInput)
          return {
            cards: timelineCards,
            teamContext: buildTeamContext(cardInput),
            deaths,
            metrics: timelineMetrics(cardInput, deaths, durationSeconds)
          }
        })()
      : undefined) as
      | {
          cards: TimelineCard[]
          teamContext: Record<number, PlayerTeamContext>
          /** 评分用死亡归责（按时间顺序） */
          deaths: AttributedDeath[]
          /** 评分用时间线指标 */
          metrics: Record<number, TimelineMetricValues>
        }
      | undefined
  }
}

export type MatchSnapshot = ReturnType<typeof buildMatchSnapshot>
