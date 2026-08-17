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
  /** 队列 id（420 单双排 / 440 灵活排位；0 = 未知）——画像按排位过滤的依据 */
  queueId: number
  /** 对局游戏版本（如 "25.14.0.877"；未知时缺省）——版本窗口过滤的依据 */
  gameVersion?: string
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

/** 排位队列集合：选人期调权重的「近期胜率」只认排位才有强度含义 */
const RANKED_QUEUE_IDS: ReadonlySet<number> = new Set([420, 440])
/** 排位场次达到该阈值才只用排位；不足时回退全量（防 ARAM/匹配玩家画像真空） */
const RANKED_MIN_GAMES = 5

/**
 * 时间衰减权重：场次数组 `games[0] = 最近一场`（LCU/SGP 均最新在前）。
 * 近 5 场权重 2、更早场次权重 1——「状态趋势」优先于「长期均值」，
 * 近 5 场 2 连败 vs 半年前 10 连胜的加权胜率如实反映当前状态。
 */
export const RECENT_WEIGHT_LEADING = 5

function gameWeight(index: number): number {
  return index < RECENT_WEIGHT_LEADING ? 2 : 1
}

/** 按时间衰减权重的比例（如加权胜率）：Σ(pick × w) / Σ(w)；空数组返回 0 */
function weightedRatio(games: RecentGameRaw[], pick: (g: RecentGameRaw) => number): number {
  let hits = 0
  let total = 0
  games.forEach((g, idx) => {
    const w = gameWeight(idx)
    total += w
    hits += pick(g) * w
  })
  return total > 0 ? hits / total : 0
}

/**
 * 版本窗口：允许对局版本比列表最新版本落后的大版本数。
 * 版本漂移的对局（重做/回调后的旧数据）对当前强度的参考价值低。
 * "25.14.0.877" 与 "25.13.1.1" 同为一大版本内（diff = 1），
 * "25.2.x"（diff = 12）属于上古数据，应剔除。
 */
const VERSION_WINDOW_MAJOR_DIFF = 1

/** 解析 "25.14.0.877" → 2514（可比较整数）；无法解析返回 null */
export function parseMajorVersion(v?: string): number | null {
  if (!v) return null
  const m = /^(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return Number(m[1]) * 100 + Number(m[2])
}

/**
 * 版本窗口过滤：以最近一场的版本为锚点，剔除落后 ≥ 2 个大版本的对局。
 * 版本信息缺失的对局保留（防误杀）；锚点缺失（无版本数据）时不过滤。
 */
function applyVersionWindow(games: RecentGameRaw[]): RecentGameRaw[] {
  const anchor = parseMajorVersion(games[0]?.gameVersion)
  if (anchor === null) return games
  return games.filter(g => {
    const v = parseMajorVersion(g.gameVersion)
    if (v === null) return true
    return anchor - v <= VERSION_WINDOW_MAJOR_DIFF
  })
}

export function buildRecentProfile(input: BuildRecentProfileInput): RecentPlayerProfile {
  const { currentTeamPosition, currentChampionId, recentGames } = input

  // — 模式过滤（ranked only） —
  // 排位胜率是选人期加权画像的依据；ARAM/匹配场次混入会稀释强度含义。
  // 排位样本不足（< 5 场）时回退全量对局——宁可数据带点噪声，也不要整卡空白。
  const rankedOnly = recentGames.filter(g => RANKED_QUEUE_IDS.has(g.queueId))
  const base = rankedOnly.length >= RANKED_MIN_GAMES ? rankedOnly : recentGames
  // — 版本窗口过滤 —
  // 版本过滤后再校验样本量：窗口内不足 5 场时回退未过滤版本的全量
  // （与排位过滤同哲学：防画像真空，宁可留点旧数据）。
  const versionWindowed = applyVersionWindow(base)
  const games = versionWindowed.length >= RANKED_MIN_GAMES ? versionWindowed : base
  const total = games.length

  // — Position distribution —
  const positionCount = new Map<TeamPosition, number>()
  for (const g of games) {
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

  // 无上下文（hover 画像卡等场景，currentTeamPosition='UNKNOWN'）时不做补位判定——
  // 「他这场打什么位置」未知，谈不上补位；避免把历史分布里的 UNKNOWN 误判为 off-role。
  const hasPositionContext = currentTeamPosition !== 'UNKNOWN'
  // 空对局视为"无判定依据"，不算 off-role
  const isOffRole = hasPositionContext && total > 0 && currentLanePlayedRatio < 0.2
  const offRoleSeverity: 'severe' | 'mild' | 'none' =
    !hasPositionContext || total === 0
      ? 'none'
      : currentLanePlayedRatio < 0.2
        ? 'severe'
        : currentLanePlayedRatio < 0.4
          ? 'mild'
          : 'none'

  // — Champion distribution —
  type LaneAgg = {
    games: number
    weightedWins: number
    weightSum: number
    kdaSum: number
  }
  type ChampAgg = {
    championId: number
    games: number
    weightedWins: number
    weightSum: number
    kdaSum: number
    /** 按位置拆分的英雄统计（分位置英雄池的原料） */
    byLane: Map<TeamPosition, LaneAgg>
  }
  const champMap = new Map<number, ChampAgg>()
  games.forEach((g, idx) => {
    const w = gameWeight(idx)
    const c = champMap.get(g.championId) ?? {
      championId: g.championId,
      games: 0,
      weightedWins: 0,
      weightSum: 0,
      kdaSum: 0,
      byLane: new Map()
    }
    c.games += 1
    c.weightSum += w
    if (g.win) c.weightedWins += w
    const dForRatio = g.deaths === 0 ? 1 : g.deaths
    c.kdaSum += (g.kills + g.assists) / dForRatio
    const lane = KNOWN_POSITIONS.has(g.teamPosition) ? (g.teamPosition as TeamPosition) : 'UNKNOWN'
    const l = c.byLane.get(lane) ?? { games: 0, weightedWins: 0, weightSum: 0, kdaSum: 0 }
    l.games += 1
    l.weightSum += w
    if (g.win) l.weightedWins += w
    l.kdaSum += (g.kills + g.assists) / dForRatio
    c.byLane.set(lane, l)
    champMap.set(g.championId, c)
  })
  const championDistribution = Array.from(champMap.values())
    .map(c => ({
      championId: c.championId,
      name: getChampionName(c.championId),
      games: c.games,
      winRate: c.weightSum > 0 ? c.weightedWins / c.weightSum : 0,
      avgKda: c.kdaSum / c.games
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 5)

  // — Position-specific champion pool —
  // 分位置口径：只统计玩家在当前局位置上打过的英雄（位置切换场景下，
  // 「他中单 100 场」对他这场打野毫无参考价值）。该位置场次 < 2 时
  // （样本不足以信）回退全位置口径，防英雄池小节的真空。
  const POSITION_CHAMP_POOL_MIN_GAMES = 2
  const positionChampPool = Array.from(champMap.values())
    .flatMap(c => {
      const l = c.byLane.get(currentTeamPosition)
      return l
        ? [
            {
              championId: c.championId,
              name: getChampionName(c.championId),
              games: l.games,
              winRate: l.weightSum > 0 ? l.weightedWins / l.weightSum : 0,
              avgKda: l.games > 0 ? l.kdaSum / l.games : 0
            }
          ]
        : []
    })
    .sort((a, b) => b.games - a.games)
  const positionPoolGames = positionChampPool.reduce((acc, c) => acc + c.games, 0)
  const positionChampionDistribution =
    positionPoolGames >= POSITION_CHAMP_POOL_MIN_GAMES ? positionChampPool.slice(0, 5) : championDistribution

  const currentChampGames = champMap.get(currentChampionId)
  const currentChampionMastery =
    total === 0
      ? null
      : currentChampGames
        ? {
            gamesInRecent: currentChampGames.games,
            winRate:
              currentChampGames.weightSum > 0
                ? currentChampGames.weightedWins / currentChampGames.weightSum
                : 0,
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
  // 近期胜率为时间加权口径：近 5 场权重 2、更早权重 1（状态趋势 > 长期均值）。
  // 与本函数其余胜率字段同口径，仅此处是主消费面（画像卡/阵容评分共同引用）。
  const recentWinRate = weightedRatio(games, g => (g.win ? 1 : 0))

  const kdaSum = games.reduce((acc, g) => {
    const d = g.deaths === 0 ? 1 : g.deaths
    return acc + (g.kills + g.assists) / d
  }, 0)
  const recentKda = total > 0 ? kdaSum / total : 0

  const streak = computeStreak(games)

  return {
    positionDistribution,
    mainPosition,
    currentLanePlayedRatio,
    championDistribution,
    positionChampionDistribution,
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
