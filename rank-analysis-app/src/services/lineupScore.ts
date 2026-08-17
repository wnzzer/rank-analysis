/**
 * 选人期「阵容强度分」——确定性计算（AI 只做解释层原则：分数由代码算，AI 只能引用与解释）。
 *
 * 依据 OP.GG 每英雄 meta（胜率 + T 级）对已锁定英雄集合做聚合：
 * - score: 覆盖英雄的胜率平均值 ×100（0-100，1 位小数），可直读为"阵容平均胜率"；
 * - bestTier: 覆盖英雄里最好的 T 级（数字越小越强，T1 最强）；
 * - covered/total: 提示覆盖度，覆盖 == 0 时 score 为 null（绝不编数字）；
 * - breakdown: 逐英雄明细（base/玩家收缩胜率/adjusted/调整理由），供 UI 解释分数来源。
 *
 * 可选「玩家画像加权」：给每个英雄附上该玩家的 RecentPlayerProfile（近 20 场聚合）。
 * 加权规则（见 playerLineupAdjustment）：
 * - 玩家近期胜率先经经验贝叶斯收缩（prior=0.5, 强度=10）——5 场全胜只当 15 场 10 胜，
 *   杜绝小样本噪声拿到最大权重；
 * - 收缩后胜率每偏离 50% 十个百分点 → 阵容分 ±3（30% 混合权重，天然有界）；
 * - 熟练度/补位为事件级修正：绝活 +2 / 熟练 +1.5 / 近期首次使用 -2 / 补位 -1~-2；
 * - 最终调整量 clamp 到 [-20, +20]，单英雄胜率 clamp 到 [0.30, 0.70] 防御极端画像。
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

/** 逐英雄明细（仅覆盖英雄；covered == 0 时为空数组） */
export interface LineupHeroDetail {
  championId: number
  /** 全局 meta 胜率 ×100；无 meta 数据时为 null（不进覆盖） */
  baseWinRate: number | null
  /** 玩家收缩后近期胜率 ×100；无画像（或画图像无近期对局）时为 null */
  playerWinRate: number | null
  /** 应用加权后的最终胜率 ×100（1 位小数） */
  adjustedWinRate: number
  /** 人类可读的调整理由（如「近期胜率 58%」「绝活」「严重补位」） */
  reasons: string[]
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
  /** 逐英雄明细（顺序与输入一致，仅覆盖英雄） */
  breakdown: LineupHeroDetail[]
}

/** 空阵容 / 全无数据时的降级结果（调用方直接隐藏强度条） */
export const EMPTY_LINEUP_SCORE: LineupScore = {
  score: null,
  covered: 0,
  total: 0,
  bestTier: null,
  playerAdjusted: false,
  breakdown: []
}

/** 由 championId 数组生成 LineupScoreInput（meta 由调用方查完再塞，这里只兜底对齐） */
export function toLineupInputs(
  ids: number[],
  metaById: ReadonlyMap<number, ChampionMeta | null>
): LineupScoreInput[] {
  return ids.map(championId => ({ championId, meta: metaById.get(championId) ?? null }))
}

/**
 * 玩家画像对单个英雄胜率的调整（0-1 概率区间）：
 *
 * 1. 近期整体胜率经经验贝叶斯收缩：shrunk = (wins + 5) / (games + 10)。
 *    - prior=0.5、强度 10：5 场全胜 → 10/15 ≈ 0.667（≈+5 分），而非 +10 分；
 *    - 20 场 12 胜 → 17/30 ≈ 0.567（≈+2 分），大样本保留更多信息。
 * 2. 收缩后胜率每偏离 50% 十个百分点 → 调整 ±0.03（30% 混合权重，天然有界）。
 * 3. 熟练度（事件级，不缩放）：绝活 +0.02；近期 ≥5 场且胜率 ≥55% +0.015；首次使用 -0.02。
 * 4. 补位：severe -0.02 / mild -0.01（无位置上下文时 buildRecentProfile 已归 none）。
 *
 * 无近期对局（total==0）视为无画像依据，返回空结果。
 */
export interface PlayerAdjustment {
  /** 收缩后玩家近期胜率（0-1）；无画像依据时 null */
  playerRate: number | null
  /** 应用到单英雄胜率的调整量（0-1），无画像依据时 0 */
  adjustment: number
  /** 人类可读理由（无画像依据时空数组） */
  reasons: string[]
}

export function playerLineupAdjustment(profile: RecentPlayerProfile): PlayerAdjustment {
  const totalGames = profile.positionDistribution.reduce((acc, p) => acc + p.games, 0)
  if (totalGames === 0) {
    return { playerRate: null, adjustment: 0, reasons: [] }
  }

  const wins = Math.round(profile.recentWinRate * totalGames)
  const shrunkRate = (wins + 5) / (totalGames + 10)
  const reasons: string[] = []
  if (Math.abs(shrunkRate - 0.5) >= 0.03) {
    reasons.push(`近期胜率 ${Math.round(shrunkRate * 100)}%`)
  }

  let adjustment = (shrunkRate - 0.5) * 0.3

  const mastery = profile.currentChampionMastery
  if (mastery) {
    if (mastery.isOnetrick) {
      adjustment += 0.02
      reasons.push('绝活')
    } else if (mastery.gamesInRecent >= 5 && mastery.winRate >= 0.55) {
      adjustment += 0.015
      reasons.push(`近${mastery.gamesInRecent}场${Math.round(mastery.winRate * 100)}%`)
    }
    if (mastery.isFirstTimeInRecent) {
      adjustment -= 0.02
      reasons.push('近期首次使用')
    }
  }

  if (profile.offRoleSeverity === 'severe') {
    adjustment -= 0.02
    reasons.push('严重补位')
  } else if (profile.offRoleSeverity === 'mild') {
    adjustment -= 0.01
    reasons.push('补位')
  }

  return {
    playerRate: shrunkRate,
    adjustment: Math.min(0.2, Math.max(-0.2, adjustment)),
    reasons
  }
}

const RATE_MIN = 0.3
const RATE_MAX = 0.7

/**
 * 对位分析输入：单英雄的玩家收缩胜率（0-1；无画像依据时按 0.5 计）。
 * position 取 OP.GG 英雄主分路——敌方 LCU 不提供分路，英雄分路是对位配对的唯一依据。
 */
export interface MatchupHeroInput {
  /** OP.GG 英雄主分路（如 'JUNGLE'；空值不参与配对） */
  position: string
  /** 玩家收缩后近期胜率（0-1），无画像依据时 null */
  rate: number | null
}

const MATCHUP_POSITION_LABEL: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

const MATCHUP_GAP_THRESHOLD = 2

/**
 * 对位分析（远期能力）：按英雄分路把双方配对，比较同一分路下玩家收缩胜率的
 * 均值差，产出人类可读提示行。只有差距 ≥ ±2% 才输出（相当的对位不制造噪音），
 * 按差距绝对值降序最多 3 条。纯函数幂等，UI 与 AI prompt 均可引用。
 */
export function computeMatchupHints(
  myTeam: MatchupHeroInput[],
  enemyTeam: MatchupHeroInput[]
): string[] {
  const group = (team: MatchupHeroInput[]): Map<string, number[]> => {
    const map = new Map<string, number[]>()
    for (const h of team) {
      if (!h.position) continue
      const list = map.get(h.position) ?? []
      list.push(h.rate ?? 0.5)
      map.set(h.position, list)
    }
    return map
  }
  const mine = group(myTeam)
  const enemy = group(enemyTeam)
  const diffs: Array<{ position: string; myAvg: number; enAvg: number; diff: number }> = []
  for (const [pos, myRates] of mine) {
    const enRates = enemy.get(pos)
    if (!enRates || enRates.length === 0) continue
    const myAvg = myRates.reduce((a, b) => a + b, 0) / myRates.length
    const enAvg = enRates.reduce((a, b) => a + b, 0) / enRates.length
    const diff = Math.round((myAvg - enAvg) * 100)
    if (Math.abs(diff) >= MATCHUP_GAP_THRESHOLD) {
      diffs.push({ position: pos, myAvg, enAvg, diff })
    }
  }
  diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  return diffs.slice(0, 3).map(d => {
    const label = MATCHUP_POSITION_LABEL[d.position] ?? d.position
    const myPct = Math.round(d.myAvg * 100)
    const enPct = Math.round(d.enAvg * 100)
    return d.diff > 0
      ? `对位·${label}：我方画像 ${myPct}% vs 敌方 ${enPct}%（我方优势 +${d.diff}%）`
      : `对位·${label}：我方画像 ${myPct}% vs 敌方 ${enPct}%（敌方优势 ${d.diff}%）`
  })
}

function clamp(rate: number): number {
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate))
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
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
      playerAdjusted: false,
      breakdown: []
    }
  }

  let sumWinRate = 0
  let playerAdjusted = false
  const breakdown: LineupHeroDetail[] = []

  for (const c of covered) {
    const base = c.meta!.winRate || 0
    const detail: LineupHeroDetail = {
      championId: c.championId,
      baseWinRate: round1(base * 100),
      playerWinRate: null,
      adjustedWinRate: round1(base * 100),
      reasons: []
    }
    if (c.profile) {
      const { playerRate, adjustment, reasons } = playerLineupAdjustment(c.profile)
      detail.playerWinRate = playerRate === null ? null : round1(playerRate * 100)
      detail.reasons = reasons
      if (adjustment !== 0) {
        playerAdjusted = true
        sumWinRate += clamp(base + adjustment)
        detail.adjustedWinRate = round1(clamp(base + adjustment) * 100)
      } else {
        sumWinRate += base
      }
    } else {
      sumWinRate += base
    }
    breakdown.push(detail)
  }

  const score = Math.round((sumWinRate / covered.length) * 1000) / 10
  const bestTier = covered.reduce(
    (acc, c) => {
      const t = c.meta!.tier || 0
      return t > 0 && (acc === null || t < acc) ? t : acc
    },
    null as number | null
  )
  return { score, covered: covered.length, total: champions.length, bestTier, playerAdjusted, breakdown }
}
