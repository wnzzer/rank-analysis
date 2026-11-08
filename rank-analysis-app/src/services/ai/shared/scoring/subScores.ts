/**
 * 分项分（spec §2）：各分项为若干 z 的均值（缺失的 z 跳过），再按权重加总成总分。
 * 单位均为「基准标准差」，0 = 同英雄同位置的平均水平。
 */
import type { MetricName } from './metrics'
import { LANE_DEATH_PENALTY, SUB_SCORE_KEYS, type SubScoreKey, type WeightProfile } from './weights'

export type SubScores = Record<SubScoreKey, number | null>

/**
 * 「越低越好」的指标。z 的符号约定统一在本文件处理：分项里取这些指标时一律经 goodness()，
 * 不要在别处再手写取负。
 */
export const LOWER_IS_BETTER: ReadonlySet<MetricName> = new Set<MetricName>([
  'deathsPerMin',
  'deathCostPerMin',
  'laneDeathResponsibility',
  'fightAbsenceRate',
  'fightFirstDeathRate'
])

/**
 * @property z - 某指标的 z（无值/无基准为 null）
 */
export interface SubScoreInput {
  hasLanes: boolean
  z: (m: MetricName) => number | null
}

const mean = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x))
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}

/** 计算六个分项（不适用或无数据的分项为 null） */
export function computeSubScores(i: SubScoreInput): SubScores {
  const { hasLanes } = i
  // 「越高越好」化的 z：LOWER_IS_BETTER 里的指标取负
  const goodness = (m: MetricName): number | null => {
    const v = i.z(m)
    return v !== null && LOWER_IS_BETTER.has(m) ? -v : v
  }
  const diffs = hasLanes
    ? mean([goodness('goldDiff14'), goodness('xpDiff14'), goodness('csDiff14')])
    : null
  return {
    // 对线期阵亡相对基准的惩罚：z 经 goodness 翻号（比同位置平均死得少 = 加分）；无 z 时只看三差
    lane:
      diffs === null
        ? null
        : diffs + LANE_DEATH_PENALTY * (goodness('laneDeathResponsibility') ?? 0),
    teamfight: mean([
      goodness('killParticipation'),
      goodness('fightAbsenceRate'),
      goodness('fightFirstDeathRate'),
      goodness('damagePerGold')
    ]),
    deathQuality: goodness('deathCostPerMin') ?? goodness('deathsPerMin'),
    growth: hasLanes ? mean([goodness('gpm'), goodness('csm')]) : goodness('damagePerGold'),
    resources: mean([goodness('objectiveDamagePerMin'), goodness('objectiveParticipation')]),
    vision: mean([goodness('visionPerMin'), goodness('controlWardsPerMin')])
  }
}

/**
 * @property contributions - 每个参与加总的分项的有效贡献（有效权重 × 分项）
 */
export interface Combined {
  total: number
  contributions: Partial<Record<SubScoreKey, number>>
}

/**
 * 按权重加总；缺失分项的权重按比例分摊给其余分项（有效权重 = w / Σ 可用 w）。
 * @returns 无任何可用分项时 total = 0
 */
export function combineSubScores(sub: SubScores, profile: WeightProfile): Combined {
  const avail = SUB_SCORE_KEYS.filter(k => (profile[k] ?? 0) > 0 && sub[k] !== null)
  const wSum = avail.reduce((s, k) => s + (profile[k] ?? 0), 0)
  if (wSum <= 0) return { total: 0, contributions: {} }
  const contributions: Partial<Record<SubScoreKey, number>> = {}
  let total = 0
  for (const k of avail) {
    const c = ((profile[k] ?? 0) / wSum) * (sub[k] as number)
    contributions[k] = c
    total += c
  }
  return { total, contributions }
}
