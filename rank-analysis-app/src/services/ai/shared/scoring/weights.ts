/**
 * 分项权重（spec §3 表，2026-11-07 用户决定：手工设定的可调常量，不做逻辑回归）。
 * 每组和为 1；某分项缺失时其权重在 combineSubScores 里按比例分摊给其余分项。
 */

export type SubScoreKey =
  'lane' | 'teamfight' | 'deathQuality' | 'growth' | 'resources' | 'vision' | 'duty'

export const SUB_SCORE_KEYS: SubScoreKey[] = [
  'lane',
  'teamfight',
  'deathQuality',
  'growth',
  'resources',
  'vision',
  'duty'
]

export const SUB_SCORE_CN: Record<SubScoreKey, string> = {
  lane: '对线',
  teamfight: '团战',
  deathQuality: '死亡质量',
  growth: '发育',
  resources: '资源',
  vision: '视野',
  duty: '职责'
}

export type WeightProfile = Partial<Record<SubScoreKey, number>>

/**
 * 按位置的权重组。打野「对线」= 与对面打野的经济/经验/补刀差（cs 含野怪，即野区资源差）；
 * 辅助「视野」= 每分钟视野分与每分钟控制守卫；大乱斗/海斗「发育」= 伤害/经济比。
 *
 * 「职责」（2026-11-09 第 2 层）= 位置本职的对线期收益，只有打野/中单/辅助有：
 * 打野 = 线上抓人，中单 = 离线支援，辅助 = 游走收益（缺位代价走死亡质量，不在此重复扣）。
 * 权重从与之重叠的分项里挪：打野从资源/团战/发育，中单从团战/死亡质量，辅助从对线/团战/死亡质量。
 */
export const WEIGHTS: Record<
  'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'NO_LANES',
  WeightProfile
> = {
  TOP: { lane: 0.3, teamfight: 0.2, deathQuality: 0.25, growth: 0.15, resources: 0.1 },
  JUNGLE: {
    lane: 0.1,
    teamfight: 0.2,
    deathQuality: 0.2,
    growth: 0.1,
    resources: 0.25,
    duty: 0.15
  },
  MIDDLE: {
    lane: 0.25,
    teamfight: 0.2,
    deathQuality: 0.2,
    growth: 0.15,
    resources: 0.1,
    duty: 0.1
  },
  BOTTOM: { lane: 0.2, teamfight: 0.35, deathQuality: 0.2, growth: 0.15, resources: 0.1 },
  // 2026-11-09：辅助 对线 0.20→0.15、团战 0.30→0.25、死亡质量 0.25→0.20，挪出 0.15 给职责（用户要求辅助阵亡减责）
  UTILITY: {
    lane: 0.15,
    teamfight: 0.25,
    deathQuality: 0.2,
    resources: 0.1,
    vision: 0.15,
    duty: 0.15
  },
  NO_LANES: { teamfight: 0.5, deathQuality: 0.3, growth: 0.2 }
}

/**
 * 对线分项的阵亡惩罚：对线 = mean(z 对位差) − 本系数 × Σ(对线期阵亡责任)。
 * 「单线被突破无人帮」= 差值 z 低 + 阵亡全为单杀（责任 1.0）→ 被扣满且无减责项。
 */
export const LANE_DEATH_PENALTY = 0.5

/**
 * 取某位置的权重组。
 * @param position - teamPosition；有分路但位置未知时按中单组
 */
export function weightProfile(position: string, hasLanes: boolean): WeightProfile {
  if (!hasLanes) return WEIGHTS.NO_LANES
  switch (position) {
    case 'TOP':
    case 'JUNGLE':
    case 'MIDDLE':
    case 'BOTTOM':
    case 'UTILITY':
      return WEIGHTS[position]
    default:
      return WEIGHTS.MIDDLE
  }
}
