/**
 * 选人期「阵容强度分」——确定性计算（AI 只做解释层原则：分数由代码算，AI 只能引用与解释）。
 *
 * 依据 OP.GG 每英雄 meta（胜率 + T 级）对已锁定英雄集合做聚合：
 * - score: 覆盖英雄的胜率平均值 ×100（0-100，1 位小数），可直读为"阵容平均胜率"；
 * - bestTier: 覆盖英雄里最好的 T 级（数字越小越强，T1 最强）；
 * - covered/total: 提示覆盖度，覆盖 == 0 时 score 为 null（绝不编数字）。
 *
 * 幂等纯函数，便于单测；取数（getChampionMeta）在 composable/页面层完成。
 */

import type { ChampionMeta } from '@renderer/services/opgg'

/** 单英雄输入：championId 恒有，meta 可为 null（该英雄无 OP.GG 数据） */
export interface LineupScoreInput {
  championId: number
  meta: ChampionMeta | null
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
}

/** 空阵容 / 全无数据时的降级结果（调用方直接隐藏强度条） */
export const EMPTY_LINEUP_SCORE: LineupScore = {
  score: null,
  covered: 0,
  total: 0,
  bestTier: null
}

/** 由 championId 数组生成 LineupScoreInput（meta 由调用方查完再塞，这里只兜底对齐） */
export function toLineupInputs(
  ids: number[],
  metaById: ReadonlyMap<number, ChampionMeta | null>
): LineupScoreInput[] {
  return ids.map(championId => ({ championId, meta: metaById.get(championId) ?? null }))
}

/** 计算阵容强度分。幂等纯函数。 */
export function computeLineupScore(champions: LineupScoreInput[]): LineupScore {
  const covered = champions.filter(c => c.meta !== null)
  if (covered.length === 0) {
    return { score: null, covered: 0, total: champions.length, bestTier: null }
  }
  const sumWinRate = covered.reduce((acc, c) => acc + (c.meta!.winRate || 0), 0)
  const score = Math.round((sumWinRate / covered.length) * 1000) / 10
  const bestTier = covered.reduce(
    (acc, c) => {
      const t = c.meta!.tier || 0
      return t > 0 && (acc === null || t < acc) ? t : acc
    },
    null as number | null
  )
  return { score, covered: covered.length, total: champions.length, bestTier }
}
