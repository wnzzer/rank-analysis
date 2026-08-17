/**
 * 选人期「阵容强度分」——确定性计算（AI 只做解释层原则：分数由代码算，AI 只能引用与解释）。
 *
 * 依据 OP.GG 每英雄 meta（胜率 + T 级）对已锁定英雄集合做聚合：
 * - score: 覆盖英雄的胜率平均值 ×100（0-100，1 位小数），可直读为"阵容平均胜率"；
 * - bestTier: 覆盖英雄里最好的 T 级（数字越小越强，T1 最强）；
 * - covered/total: 提示覆盖度，覆盖 == 0 时 score 为 null（绝不编数字）。
 *
 * 可选「玩家画像加权」：给每个英雄附上该玩家的 RecentPlayerProfile（近 20 场聚合），
 * 分数在全局 meta 基础上按玩家近期表现平移（见 playerLineupAdjustment），
 * 加权后 clamp 到 [0.25, 0.85]，防止极端画像把分数推到不合理的全赢/全输区间。
 *
 * 幂等纯函数，便于单测；取数（getChampionMeta / fetchBatchProfiles）在 composable/页面层完成。
 */

import type { ChampionMeta } from '@renderer/services/opgg'
import type { RecentPlayerProfile } from '@renderer/services/ai/shared/types'

/** 单英雄输入：championId 恒有，meta 可为 null（该英雄无 OP.GG 数据）；profile 可选 */
export interface LineupScoreInput {
  championId: number
  meta: ChampionMeta | null
  /** 该英雄使用者画像（可选）。null 视为无画像，纯全局 meta 出分 */
  profile?: RecentPlayerProfile | null
}

export interface LineupScore {
  /** 阵容平均胜率 ×100（1 位小数）；covered == 0 时为 null（数据不足，不编造） */
  score: number | null
  /** 有 meta 数据的英雄数 */
  covered: number
  /** 阵容英雄总数 */
  total: number
  /** 覆盖英雄中最好的 T 级（数字越小越强）；无覆盖时为 null */
  bestTier: number | null
  /** 是否应用过玩家画像加权（任一人画像产生非零调整即为 true） */
  playerAdjusted: boolean
}

/** 空阵容 / 全无数据时的降级结果（调用方直接隐藏强度条） */
export const EMPTY_LINEUP_SCORE: LineupScore = {
  score: null,
  covered: 0,
  total: 0,
  bestTier: null,
  playerAdjusted: false
}

/** 由 championId 数组生成 LineupScoreInput（meta 由调用方查完再塞，这里只兜底对齐） */
export function toLineupInputs(
  ids: number[],
  metaById: ReadonlyMap<number, ChampionMeta | null>
): LineupScoreInput[] {
  return ids.map(championId => ({ championId, meta: metaById.get(championId) ?? null }))
}

/**
 * 玩家画像对单个英雄胜率的调整量（0-1 概率区间）：
 * - 近期整体胜率每偏离 50% 十个百分点 → ±0.02（60% 胜率 +0.02，45% 胜率 -0.01）
 * - 熟练度：绝活 +0.02；近期 ≥5 场且胜率 ≥55% +0.015；近期首次使用该英雄 -0.02
 * - 补位：severe -0.02 / mild -0.01（无位置上下文时 buildRecentProfile 已归 none）
 * - 无近期对局（total==0）视为无画像依据，返回 0
 */
export function playerLineupAdjustment(profile: RecentPlayerProfile): number {
  const totalGames = profile.positionDistribution.reduce((acc, p) => acc + p.games, 0)
  if (totalGames === 0) return 0

  let adjustment = (profile.recentWinRate - 0.5) * 0.2

  const mastery = profile.currentChampionMastery
  if (mastery) {
    if (mastery.isOnetrick) adjustment += 0.02
    else if (mastery.gamesInRecent >= 5 && mastery.winRate >= 0.55) adjustment += 0.015
    if (mastery.isFirstTimeInRecent) adjustment -= 0.02
  }

  if (profile.offRoleSeverity === 'severe') adjustment -= 0.02
  else if (profile.offRoleSeverity === 'mild') adjustment -= 0.01

  return adjustment
}

const RATE_MIN = 0.25
const RATE_MAX = 0.85

function clamp(rate: number): number {
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate))
}

/** 计算阵容强度分。幂等纯函数。 */
export function computeLineupScore(champions: LineupScoreInput[]): LineupScore {
  const covered = champions.filter(c => c.meta !== null)
  if (covered.length === 0) {
    return {
      score: null,
      covered: 0,
      total: champions.length,
      bestTier: null,
      playerAdjusted: false
    }
  }
  let sumWinRate = 0
  let playerAdjusted = false
  for (const c of covered) {
    const base = c.meta!.winRate || 0
    const adj = c.profile ? playerLineupAdjustment(c.profile) : 0
    if (adj !== 0) playerAdjusted = true
    sumWinRate += adj === 0 ? base : clamp(base + adj)
  }
  const score = Math.round((sumWinRate / covered.length) * 1000) / 10
  const bestTier = covered.reduce(
    (acc, c) => {
      const t = c.meta!.tier || 0
      return t > 0 && (acc === null || t < acc) ? t : acc
    },
    null as number | null
  )
  return { score, covered: covered.length, total: champions.length, bestTier, playerAdjusted }
}
