/**
 * 战绩详情页的玩家数据整理：
 * - 将 game 拍平为 DetailPlayer[]
 * - 计算队伍汇总、所属 teamRelative 占比
 * - 打"最多杀人/伤害/助攻/推塔/金币/承伤/补兵" badges
 * - WeGame 式综合评分选 MVP（胜方最高分）/ SVP（败方最高分）
 */

import { computed, type MaybeRefOrGetter, toValue, type Component } from 'vue'
import {
  CashOutline,
  FlagOutline,
  FlameOutline,
  FlashOutline,
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
  /** 玩家唯一标识，来自 participantIdentity，用于玩家备注 */
  puuid: string
  gameName: string
  tagLine: string
  isMe: boolean
  win: boolean
  badges: PlayerBadge[]
  /** WeGame 式综合评分（0~10），见 {@link computeMatchScore} */
  score: number
  /** 胜方最高分 MVP / 败方最高分 SVP，其余为空 */
  mvpTag: 'MVP' | 'SVP' | ''
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

/** 评分上下文：所属队伍总击杀（参团率分母）+ 全场各维度最大值（归一化分母） */
export interface ScoreContext {
  teamKills: number
  max: { damage: number; taken: number; gold: number; cs: number; turret: number }
}

/**
 * WeGame 式综合评分（0~10）：KDA、输出、参团率、承伤、经济、补刀、推塔 七维加权。
 *
 * 各维归一到 0..1（KDA 用饱和函数 kda/(kda+3)，其余除以全场最大值），加权和乘 10。
 * 权重：KDA 26% / 输出 22% / 参团 18% / 承伤 10% / 经济 10% / 补刀 8% / 推塔 6%。
 *
 * ⚠️ 与后端 `match_history.rs::wegame_score` 同式——两端必须同步修改。
 */
export function computeMatchScore(s: ParticipantStats, ctx: ScoreContext): number {
  const kda = (s.kills + s.assists) / Math.max(1, s.deaths)
  const nKda = kda / (kda + 3)
  const kp = ctx.teamKills > 0 ? Math.min(1, (s.kills + s.assists) / ctx.teamKills) : 0
  const norm = (v: number, m: number) => (m > 0 ? v / m : 0)
  return (
    10 *
    (0.26 * nKda +
      0.22 * norm(s.totalDamageDealtToChampions, ctx.max.damage) +
      0.18 * kp +
      0.1 * norm(s.totalDamageTaken, ctx.max.taken) +
      0.1 * norm(s.goldEarned, ctx.max.gold) +
      0.08 * norm(totalCs(s), ctx.max.cs) +
      0.06 * norm(s.damageDealtToTurrets, ctx.max.turret))
  )
}

/**
 * 多杀荣誉徽章：三杀及以上才上榜（双杀太常见，出徽章反而注水），
 * 次数 >1 时 label 带 "×N"。顺序即展示顺序：五杀 > 四杀 > 三杀，整体排在"最多"类徽章前。
 */
const multiKillBadgeConfigs = [
  {
    key: 'penta',
    label: '五杀',
    className: 'match-detail-badge-penta',
    value: (s: ParticipantStats) => s.pentaKills ?? 0
  },
  {
    key: 'quadra',
    label: '四杀',
    className: 'match-detail-badge-quadra',
    value: (s: ParticipantStats) => s.quadraKills ?? 0
  },
  {
    key: 'triple',
    label: '三杀',
    className: 'match-detail-badge-triple',
    value: (s: ParticipantStats) => s.tripleKills ?? 0
  }
]

/** 单玩家的多杀徽章列表（无多杀时为空数组） */
function multiKillBadges(stats: ParticipantStats): PlayerBadge[] {
  return multiKillBadgeConfigs
    .filter(cfg => cfg.value(stats) > 0)
    .map(cfg => {
      const count = cfg.value(stats)
      return {
        key: cfg.key,
        label: count > 1 ? `${cfg.label}×${count}` : cfg.label,
        icon: FlashOutline,
        className: cfg.className
      }
    })
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
    key: 'damage',
    label: '伤害最多',
    icon: FlameOutline,
    className: 'match-detail-badge-damage',
    value: (s: ParticipantStats) => s.totalDamageDealtToChampions
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

    const teamTotals = new Map<
      number,
      { damage: number; taken: number; heal: number; kills: number }
    >()
    for (const p of participants) {
      const key = groupKey(p)
      const cur = teamTotals.get(key) ?? { damage: 0, taken: 0, heal: 0, kills: 0 }
      cur.damage += p.stats.totalDamageDealtToChampions
      cur.taken += p.stats.totalDamageTaken
      cur.heal += p.stats.totalHeal
      cur.kills += p.stats.kills
      teamTotals.set(key, cur)
    }

    // WeGame 式评分：全场各维度最大值做归一化分母，逐人打分
    const gameMax = { damage: 0, taken: 0, gold: 0, cs: 0, turret: 0 }
    for (const p of participants) {
      gameMax.damage = Math.max(gameMax.damage, p.stats.totalDamageDealtToChampions)
      gameMax.taken = Math.max(gameMax.taken, p.stats.totalDamageTaken)
      gameMax.gold = Math.max(gameMax.gold, p.stats.goldEarned)
      gameMax.cs = Math.max(gameMax.cs, totalCs(p.stats))
      gameMax.turret = Math.max(gameMax.turret, p.stats.damageDealtToTurrets)
    }
    const scoreById = new Map<number, number>()
    for (const p of participants) {
      scoreById.set(
        p.participantId,
        computeMatchScore(p.stats, {
          teamKills: teamTotals.get(groupKey(p))?.kills ?? 0,
          max: gameMax
        })
      )
    }
    // 胜方最高分 MVP、败方最高分 SVP（并列时取 participantId 小者，保证确定性）
    const bestOf = (win: boolean) =>
      [...participants]
        .filter(p => p.stats.win === win)
        .sort(
          (a, b) =>
            (scoreById.get(b.participantId) ?? 0) - (scoreById.get(a.participantId) ?? 0) ||
            a.participantId - b.participantId
        )[0]?.participantId
    const mvpId = bestOf(true)
    const svpId = bestOf(false)

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
        const totals = teamTotals.get(groupKey(p)) ?? { damage: 0, taken: 0, heal: 0, kills: 0 }

        return {
          score: scoreById.get(p.participantId) ?? 0,
          mvpTag: (p.participantId === mvpId
            ? 'MVP'
            : p.participantId === svpId
              ? 'SVP'
              : '') as DetailPlayer['mvpTag'],
          participantId: p.participantId,
          teamId: p.teamId,
          championId: p.championId,
          spell1Id: p.spell1Id,
          spell2Id: p.spell2Id,
          stats: p.stats,
          displayName,
          puuid: identity?.player.puuid ?? '',
          gameName: identity?.player.gameName ?? '',
          tagLine: identity?.player.tagLine ?? '',
          isMe: displayName === toValue(currentPlayerKey),
          win: p.stats.win,
          badges: [
            ...multiKillBadges(p.stats),
            ...badgeConfigs
              .filter(cfg => badgeWinners.get(cfg.label)?.has(p.participantId))
              .map(cfg => ({
                key: cfg.key,
                label: cfg.label,
                icon: cfg.icon,
                className: cfg.className
              }))
          ],
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
