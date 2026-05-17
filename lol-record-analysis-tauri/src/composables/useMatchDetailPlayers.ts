/**
 * 战绩详情页的玩家数据整理：
 * - 将 game 拍平为 DetailPlayer[]
 * - 计算队伍汇总、所属 teamRelative 占比
 * - 打"最多杀人/助攻/推塔/金币/承伤/补兵" badges
 */

import { computed, type MaybeRefOrGetter, toValue, type Component } from 'vue'
import {
  CashOutline,
  FlagOutline,
  FootstepsOutline,
  PeopleOutline,
  ShieldOutline,
  SkullOutline
} from '@vicons/ionicons5'
import type { Game, Participant, ParticipantStats } from '@renderer/types/domain/match'
import { safeRelativePercent } from '@renderer/utils/format'

const PLACEMENT_LABEL = (p: number) => (p > 0 ? `第 ${p} 名` : '')

export interface PlayerBadge {
  key: string
  label: string
  icon: Component
  className: string
}

export interface DetailPlayer {
  participantId: number
  teamId: number
  championId: number
  spell1Id: number
  spell2Id: number
  stats: ParticipantStats
  displayName: string
  isMe: boolean
  win: boolean
  badges: PlayerBadge[]
  teamRelative: {
    damage: number
    taken: number
    heal: number
  }
}

export interface TeamSection {
  teamId: number
  players: DetailPlayer[]
  title: string
  headerClass: string
  kills: number
  deaths: number
  assists: number
  gold: number
  damage: number
  taken: number
}

function totalCs(stats: ParticipantStats) {
  return stats.totalMinionsKilled + stats.neutralMinionsKilled
}

const badgeConfigs = [
  {
    key: 'kills',
    label: '杀人最多',
    icon: SkullOutline,
    className: 'match-detail-badge-kills',
    value: (s: ParticipantStats) => s.kills
  },
  {
    key: 'assists',
    label: '助攻最多',
    icon: PeopleOutline,
    className: 'match-detail-badge-assists',
    value: (s: ParticipantStats) => s.assists
  },
  {
    key: 'turrets',
    label: '推塔最多',
    icon: FlagOutline,
    className: 'match-detail-badge-turrets',
    value: (s: ParticipantStats) => s.damageDealtToTurrets
  },
  {
    key: 'gold',
    label: '钱最多',
    icon: CashOutline,
    className: 'match-detail-badge-gold',
    value: (s: ParticipantStats) => s.goldEarned
  },
  {
    key: 'taken',
    label: '承伤最多',
    icon: ShieldOutline,
    className: 'match-detail-badge-taken',
    value: (s: ParticipantStats) => s.totalDamageTaken
  },
  {
    key: 'cs',
    label: '补兵最多',
    icon: FootstepsOutline,
    className: 'match-detail-badge-cs',
    value: (s: ParticipantStats) => totalCs(s)
  }
]

export function useMatchDetailPlayers(
  game: MaybeRefOrGetter<Game | null>,
  currentPlayerKey: MaybeRefOrGetter<string>
) {
  const detailPlayers = computed<DetailPlayer[]>(() => {
    const g = toValue(game)
    if (!g) return []

    const participants = g.gameDetail?.participants?.length
      ? g.gameDetail.participants
      : g.participants
    const identities = g.gameDetail?.participantIdentities?.length
      ? g.gameDetail.participantIdentities
      : g.participantIdentities

    // CHERRY/斗魂的 teamId 是 9 人大组(100/200)，每个大组含 3 个 subteam。
    // teamRelative 占比必须按 stats.playerSubteamId 算 2~3 人小队，否则分母被放大 3 倍。
    const isCherry = g.gameMode === 'CHERRY'
    const groupKey = (p: Participant) =>
      isCherry && p.stats.playerSubteamId > 0 ? p.stats.playerSubteamId : p.teamId

    const teamTotals = new Map<number, { damage: number; taken: number; heal: number }>()
    for (const p of participants) {
      const key = groupKey(p)
      const cur = teamTotals.get(key) ?? { damage: 0, taken: 0, heal: 0 }
      cur.damage += p.stats.totalDamageDealtToChampions
      cur.taken += p.stats.totalDamageTaken
      cur.heal += p.stats.totalHeal
      teamTotals.set(key, cur)
    }

    const badgeWinners = new Map<string, Set<number>>()
    for (const cfg of badgeConfigs) {
      const maxValue = participants.reduce((m, p) => Math.max(m, cfg.value(p.stats)), 0)
      if (maxValue <= 0) continue
      badgeWinners.set(
        cfg.label,
        new Set(participants.filter(p => cfg.value(p.stats) === maxValue).map(p => p.participantId))
      )
    }

    return [...participants]
      .sort((a, b) => a.participantId - b.participantId)
      .map((p, i) => {
        const identity = identities[p.participantId - 1] ?? identities[i]
        const displayName = identity
          ? `${identity.player.gameName}#${identity.player.tagLine}`
          : `玩家${p.participantId}`
        const totals = teamTotals.get(groupKey(p)) ?? { damage: 0, taken: 0, heal: 0 }

        return {
          participantId: p.participantId,
          teamId: p.teamId,
          championId: p.championId,
          spell1Id: p.spell1Id,
          spell2Id: p.spell2Id,
          stats: p.stats,
          displayName,
          isMe: displayName === toValue(currentPlayerKey),
          win: p.stats.win,
          badges: badgeConfigs
            .filter(cfg => badgeWinners.get(cfg.label)?.has(p.participantId))
            .map(cfg => ({
              key: cfg.key,
              label: cfg.label,
              icon: cfg.icon,
              className: cfg.className
            })),
          teamRelative: {
            damage: safeRelativePercent(p.stats.totalDamageDealtToChampions, totals.damage),
            taken: safeRelativePercent(p.stats.totalDamageTaken, totals.taken),
            heal: safeRelativePercent(p.stats.totalHeal, totals.heal)
          }
        }
      })
  })

  const mySummary = computed(() => detailPlayers.value.find(p => p.isMe) ?? detailPlayers.value[0])

  const teamSections = computed<TeamSection[]>(() => {
    const g = toValue(game)
    const isCherry = g?.gameMode === 'CHERRY'

    if (isCherry) {
      const map = new Map<number, DetailPlayer[]>()
      for (const p of detailPlayers.value) {
        const sid = p.stats.playerSubteamId
        if (!map.has(sid)) map.set(sid, [])
        map.get(sid)!.push(p)
      }
      return [...map.entries()]
        .map(([subteamId, players]) => {
          const placement = players[0]?.stats.subteamPlacement ?? 0
          const won = players[0]?.stats.win ?? false
          const totals = players.reduce(
            (acc, p) => {
              acc.kills += p.stats.kills
              acc.deaths += p.stats.deaths
              acc.assists += p.stats.assists
              acc.gold += p.stats.goldEarned
              acc.damage += p.stats.totalDamageDealtToChampions
              acc.taken += p.stats.totalDamageTaken
              return acc
            },
            { kills: 0, deaths: 0, assists: 0, gold: 0, damage: 0, taken: 0 }
          )
          return {
            teamId: subteamId,
            players,
            title: `队伍 ${subteamId} · ${PLACEMENT_LABEL(placement)}`,
            headerClass: won ? 'match-detail-team-header-win' : 'match-detail-team-header-loss',
            ...totals
          }
        })
        .sort((a, b) => {
          const pa = a.players[0]?.stats.subteamPlacement ?? 99
          const pb = b.players[0]?.stats.subteamPlacement ?? 99
          return pa - pb
        })
    }

    const teamMap = new Map<number, DetailPlayer[]>()
    for (const player of detailPlayers.value) {
      const cur = teamMap.get(player.teamId) ?? []
      cur.push(player)
      teamMap.set(player.teamId, cur)
    }

    return [...teamMap.entries()]
      .map(([teamId, players]) => {
        const totals = players.reduce(
          (acc, p) => {
            acc.kills += p.stats.kills
            acc.deaths += p.stats.deaths
            acc.assists += p.stats.assists
            acc.gold += p.stats.goldEarned
            acc.damage += p.stats.totalDamageDealtToChampions
            acc.taken += p.stats.totalDamageTaken
            return acc
          },
          { kills: 0, deaths: 0, assists: 0, gold: 0, damage: 0, taken: 0 }
        )
        const won = players[0]?.win ?? false
        return {
          teamId,
          players,
          title: won ? '胜方' : '败方',
          headerClass: won ? 'match-detail-team-header-win' : 'match-detail-team-header-loss',
          ...totals
        }
      })
      .sort((a, b) => Number(b.players[0]?.win ?? false) - Number(a.players[0]?.win ?? false))
  })

  return { detailPlayers, mySummary, teamSections }
}
