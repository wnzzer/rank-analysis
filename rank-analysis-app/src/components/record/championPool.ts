import type { Game } from '@renderer/types/domain/match'

/**
 * 英雄池聚合：从对局列表（趋势条 50 场）按 championId 聚合胜率与场次。
 *
 * 设计文档 M1-B5-1：行卡 hover → 左栏英雄池定位并展开该英雄近 30 场聚合。
 * 数据源用趋势条已加载的最近 50 场（对齐后端 MAX_CACHE_END = 49），
 * 纯函数便于单测。
 */
export interface ChampionPoolEntry {
  championId: number
  /** 该英雄出现场次（≤ 50 场窗口） */
  count: number
  wins: number
  losses: number
  /** 胜率百分比（0-100，无对局时为 0） */
  winRate: number
  /** 该英雄的场次明细（时间降序，供 hover 展开/定位） */
  games: Game[]
}

/** 聚合结果保持出现次数降序（出场率高的英雄置顶） */
export function aggregateChampionPool(games: Game[]): ChampionPoolEntry[] {
  const map = new Map<number, ChampionPoolEntry>()
  for (const game of games) {
    const championId = game.participants[0]?.championId
    if (!championId || championId <= 0) continue
    let entry = map.get(championId)
    if (!entry) {
      entry = { championId, count: 0, wins: 0, losses: 0, winRate: 0, games: [] }
      map.set(championId, entry)
    }
    entry.count += 1
    if (game.participants[0]?.stats?.win) {
      entry.wins += 1
    } else {
      entry.losses += 1
    }
    entry.games.push(game)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.wins - a.wins)
}

/** 单英雄的胜率（供列表行直接渲染） */
export function championWinRate(entry: ChampionPoolEntry): number {
  if (entry.count === 0) return 0
  return Math.round((entry.wins / entry.count) * 100)
}

/**
 * 英雄池阈值筛选：保留「胜率 ≥ minWinRatePct 且 场次 ≥ minGames」的英雄。
 *
 * 胜率口径与 `championWinRate` 一致（wins/count 四舍五入为整数百分比），
 * 保证筛选结果和列表展示的百分比严格同源。保持聚合排序（出现次数降序）。
 *
 * @param pool - 聚合后的英雄池（通常来自 `aggregateChampionPool`）
 * @param minWinRatePct - 最低胜率（0-100 整数百分比）
 * @param minGames - 最低场次
 */
export function filterChampionPoolByThresholds(
  pool: ChampionPoolEntry[],
  minWinRatePct: number,
  minGames: number
): ChampionPoolEntry[] {
  return pool.filter(e => championWinRate(e) >= minWinRatePct && e.count >= minGames)
}
