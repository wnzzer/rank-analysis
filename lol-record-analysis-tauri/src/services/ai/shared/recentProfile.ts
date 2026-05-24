/**
 * 单玩家近期对局聚合（纯函数）。
 */

import { getChampionName } from '../champion-names'
import type { RecentPlayerProfile, TeamPosition } from './types'

export interface RecentGameRaw {
  teamPosition: string
  championId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
}

export interface BuildRecentProfileInput {
  currentTeamPosition: TeamPosition
  currentChampionId: number
  recentGames: RecentGameRaw[]
}

const KNOWN_POSITIONS: ReadonlySet<string> = new Set([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'UTILITY'
])

export function buildRecentProfile(input: BuildRecentProfileInput): RecentPlayerProfile {
  const { currentTeamPosition, currentChampionId, recentGames } = input
  const total = recentGames.length

  // — Position distribution —
  const positionCount = new Map<TeamPosition, number>()
  for (const g of recentGames) {
    const pos = KNOWN_POSITIONS.has(g.teamPosition) ? (g.teamPosition as TeamPosition) : 'UNKNOWN'
    positionCount.set(pos, (positionCount.get(pos) ?? 0) + 1)
  }
  const positionDistribution = Array.from(positionCount.entries())
    .map(([pos, games]) => ({ pos, ratio: total > 0 ? games / total : 0, games }))
    .sort((a, b) => b.ratio - a.ratio)

  const mainPosition: TeamPosition | 'UNCLEAR' =
    positionDistribution[0] && positionDistribution[0].ratio >= 0.4
      ? positionDistribution[0].pos
      : 'UNCLEAR'

  const currentLaneEntry = positionDistribution.find(p => p.pos === currentTeamPosition)
  const currentLanePlayedRatio = currentLaneEntry?.ratio ?? 0

  // 空对局视为"无判定依据"，不算 off-role
  const isOffRole = total > 0 && currentLanePlayedRatio < 0.2
  const offRoleSeverity: 'severe' | 'mild' | 'none' =
    total === 0
      ? 'none'
      : currentLanePlayedRatio < 0.2
        ? 'severe'
        : currentLanePlayedRatio < 0.4
          ? 'mild'
          : 'none'

  // — Champion distribution —
  type ChampAgg = { championId: number; games: number; wins: number; kdaSum: number }
  const champMap = new Map<number, ChampAgg>()
  for (const g of recentGames) {
    const c = champMap.get(g.championId) ?? {
      championId: g.championId,
      games: 0,
      wins: 0,
      kdaSum: 0
    }
    c.games += 1
    if (g.win) c.wins += 1
    const dForRatio = g.deaths === 0 ? 1 : g.deaths
    c.kdaSum += (g.kills + g.assists) / dForRatio
    champMap.set(g.championId, c)
  }
  const championDistribution = Array.from(champMap.values())
    .map(c => ({
      championId: c.championId,
      name: getChampionName(c.championId),
      games: c.games,
      winRate: c.wins / c.games,
      avgKda: c.kdaSum / c.games
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 5)

  const currentChampGames = champMap.get(currentChampionId)
  const currentChampionMastery =
    total === 0
      ? null
      : currentChampGames
        ? {
            gamesInRecent: currentChampGames.games,
            winRate: currentChampGames.wins / currentChampGames.games,
            avgKda: currentChampGames.kdaSum / currentChampGames.games,
            isOnetrick: currentChampGames.games / total > 0.5,
            isFirstTimeInRecent: false
          }
        : {
            gamesInRecent: 0,
            winRate: 0,
            avgKda: 0,
            isOnetrick: false,
            isFirstTimeInRecent: true
          }

  // — Recent rates & streak —
  const wins = recentGames.filter(g => g.win).length
  const recentWinRate = total > 0 ? wins / total : 0

  const kdaSum = recentGames.reduce((acc, g) => {
    const d = g.deaths === 0 ? 1 : g.deaths
    return acc + (g.kills + g.assists) / d
  }, 0)
  const recentKda = total > 0 ? kdaSum / total : 0

  const streak = computeStreak(recentGames)

  return {
    positionDistribution,
    mainPosition,
    currentLanePlayedRatio,
    championDistribution,
    currentChampionMastery,
    recentWinRate,
    recentKda,
    streak,
    isOffRole,
    offRoleSeverity
  }
}

function computeStreak(games: RecentGameRaw[]): { kind: 'win' | 'loss'; count: number } | null {
  if (games.length === 0) return null
  const first = games[0]
  const kind: 'win' | 'loss' = first.win ? 'win' : 'loss'
  let count = 0
  for (const g of games) {
    if (g.win === first.win) count += 1
    else break
  }
  return { kind, count }
}
