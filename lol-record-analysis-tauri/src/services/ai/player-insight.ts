/**
 * 从 MatchHistory + UserTag 聚合数据中抽取"可喂给 LLM 的玩家画像"
 * 从 buildTeamAnalysisPrompt 与 buildPlayerAnalysisPrompt 两处重复逻辑提取
 */

import { getChampionName } from './champion-names'

interface ChampionAggregate {
  count: number
  wins: number
  totalKda: number
  totalDamage: number
}

function aggregateChampionStats(recentGames: any[]): Record<number, ChampionAggregate> {
  const stats: Record<number, ChampionAggregate> = {}
  recentGames.forEach((g: any) => {
    const champId = g.participants[0]?.championId
    if (!champId) return
    if (!stats[champId]) {
      stats[champId] = { count: 0, wins: 0, totalKda: 0, totalDamage: 0 }
    }
    const s = stats[champId]
    s.count++
    if (g.participants[0].stats.win) s.wins++
    s.totalKda +=
      (g.participants[0].stats.kills + g.participants[0].stats.assists) /
      Math.max(g.participants[0].stats.deaths, 1)
    s.totalDamage += g.participants[0].stats.totalDamageDealtToChampions || 0
  })
  return stats
}

/** 返回出场次数 top N 的英雄（均值已计算） */
export function extractTopChampions(recentGames: any[], limit = 5) {
  const stats = aggregateChampionStats(recentGames)
  return Object.entries(stats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([champId, s]) => ({
      champion: getChampionName(Number(champId)),
      games: s.count,
      winRate: Math.round((s.wins / s.count) * 100),
      avgKda: (s.totalKda / s.count).toFixed(2),
      avgDamage: Math.round(s.totalDamage / s.count)
    }))
}

export function extractMainPosition(recentGames: any[]): string {
  const positionStats: Record<string, number> = {}
  recentGames.forEach((g: any) => {
    const pos = g.participants[0]?.timeline?.lane || g.participants[0]?.selectedPosition || 'UNKNOWN'
    positionStats[pos] = (positionStats[pos] || 0) + 1
  })
  return Object.entries(positionStats).sort((a, b) => b[1] - a[1])[0]?.[0] || '未知'
}

export function extractPositionStats(recentGames: any[]): Record<string, number> {
  const positionStats: Record<string, number> = {}
  recentGames.forEach((g: any) => {
    const pos = g.participants[0]?.timeline?.lane || 'UNKNOWN'
    positionStats[pos] = (positionStats[pos] || 0) + 1
  })
  return positionStats
}

function recentGamePreview(g: any, includeEconomy = true) {
  const base = {
    champion: getChampionName(g.participants[0]?.championId),
    win: g.participants[0].stats.win,
    kills: g.participants[0].stats.kills,
    deaths: g.participants[0].stats.deaths,
    assists: g.participants[0].stats.assists,
    kda: (
      (g.participants[0].stats.kills + g.participants[0].stats.assists) /
      Math.max(g.participants[0].stats.deaths, 1)
    ).toFixed(2),
    queue: g.queueName
  }
  if (!includeEconomy) return base
  return {
    ...base,
    damage: g.participants[0].stats.totalDamageDealtToChampions,
    gold: g.participants[0].stats.goldEarned
  }
}

/** 抽取玩家画像（用于队伍对比场景） */
export function extractPlayerInsight(p: any, opts: { detailed: boolean }) {
  const recentGames = p.matchHistory?.games?.games || []
  const tags = p.userTag?.tag || []
  const recent = p.userTag?.recentData
  const winRate =
    recent?.selectWins && recent?.selectLosses
      ? Math.round((recent.selectWins / (recent.selectWins + recent.selectLosses)) * 100)
      : 0

  const recentStats: Record<string, any> = {
    wins: recent?.selectWins || 0,
    losses: recent?.selectLosses || 0,
    winRate,
    kda: recent?.kda?.toFixed(2) || '0.00',
    groupRate: recent?.groupRate || 0,
    damageRate: recent?.damageDealtToChampionsRate || 0
  }
  if (opts.detailed) {
    recentStats.kills = recent?.kills?.toFixed(1) || '0.0'
    recentStats.deaths = recent?.deaths?.toFixed(1) || '0.0'
    recentStats.assists = recent?.assists?.toFixed(1) || '0.0'
  }

  return {
    name: p.summoner?.gameName || '未知',
    currentChampion: getChampionName(p.championId),
    tier: p.rank?.queueMap?.RANKED_SOLO_5x5?.tierCn || '无段位',
    level: p.summoner?.summonerLevel,
    recentStats,
    topChampions: extractTopChampions(recentGames),
    mainPosition: extractMainPosition(recentGames),
    tags: tags.map((t: any) => ({
      name: t.tagName,
      desc: t.tagDesc,
      isGood: t.good
    })),
    recentGamesPreview: recentGames
      .slice(0, 10)
      .map((g: any) => recentGamePreview(g, opts.detailed))
  }
}

/** 抽取更详细的单玩家画像（战绩详情更多，15 场） */
export function extractPlayerDeepDive(player: any) {
  const recentGames = player.matchHistory?.games?.games || []
  return {
    topChampions: extractTopChampions(recentGames),
    positionStats: extractPositionStats(recentGames),
    detailedGames: recentGames.slice(0, 15).map((g: any) => ({
      ...recentGamePreview(g, true),
      gameMode: g.gameMode
    }))
  }
}
