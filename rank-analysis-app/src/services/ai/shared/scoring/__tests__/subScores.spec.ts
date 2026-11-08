/**
 * 权重常量与分项计算（期望值均手算）。
 */
import { describe, it, expect } from 'vitest'
import type { MetricName } from '../metrics'
import { combineSubScores, computeSubScores, LOWER_IS_BETTER } from '../subScores'
import { LANE_DEATH_PENALTY, WEIGHTS, weightProfile } from '../weights'

const Z: Partial<Record<MetricName, number | null>> = {
  goldDiff14: 1,
  xpDiff14: 0.5,
  csDiff14: 0,
  killParticipation: 1,
  fightAbsenceRate: 0.5,
  fightFirstDeathRate: null,
  damagePerGold: 0.2,
  deathCostPerMin: 1.2,
  laneDeathResponsibility: 1.5,
  deathsPerMin: 2,
  gpm: 0.4,
  csm: -0.2,
  objectiveDamagePerMin: 0.6,
  objectiveParticipation: null,
  visionPerMin: -1,
  controlWardsPerMin: null
}
const z = (m: MetricName) => Z[m] ?? null

describe('weights', () => {
  it('每组权重和为 1', () => {
    for (const profile of Object.values(WEIGHTS)) {
      const sum = Object.values(profile).reduce((s, w) => s + (w ?? 0), 0)
      expect(sum).toBeCloseTo(1)
    }
  })
  it('未知位置用中单组；无分路用大乱斗组', () => {
    expect(weightProfile('UNKNOWN', true)).toBe(WEIGHTS.MIDDLE)
    expect(weightProfile('TOP', false)).toBe(WEIGHTS.NO_LANES)
  })
  it('对线阵亡惩罚是 0.5（Task 15 决策闸可调）', () => {
    expect(LANE_DEATH_PENALTY).toBe(0.5)
  })
})

describe('LOWER_IS_BETTER', () => {
  it('集中登记「越低越好」的指标，符号只在这里处理', () => {
    expect([...LOWER_IS_BETTER].sort()).toEqual(
      [
        'deathCostPerMin',
        'deathsPerMin',
        'fightAbsenceRate',
        'fightFirstDeathRate',
        'laneDeathResponsibility'
      ].sort()
    )
  })
})

describe('computeSubScores', () => {
  it('有分路：各分项为对应 z 的均值，死亡类取负，对线 = 三差均值 + 0.5×(−z(对线阵亡责任))', () => {
    const s = computeSubScores({ hasLanes: true, z })
    expect(s.lane).toBeCloseTo(-0.25)
    expect(s.teamfight).toBeCloseTo(0.23333, 4)
    expect(s.deathQuality).toBeCloseTo(-1.2)
    expect(s.growth).toBeCloseTo(0.1)
    expect(s.resources).toBeCloseTo(0.6)
    expect(s.vision).toBeCloseTo(-1)
  })
  it('对线阵亡与基准持平（z=0）：不扣分，对线 = 三差均值', () => {
    const s = computeSubScores({
      hasLanes: true,
      z: m => (m === 'laneDeathResponsibility' ? 0 : z(m))
    })
    expect(s.lane).toBeCloseTo(0.5)
  })
  it('对线阵亡比基准少 1 个标准差：加 0.5；z 缺失：只看三差', () => {
    const fewer = computeSubScores({
      hasLanes: true,
      z: m => (m === 'laneDeathResponsibility' ? -1 : z(m))
    })
    expect(fewer.lane).toBeCloseTo(1)
    const missing = computeSubScores({
      hasLanes: true,
      z: m => (m === 'laneDeathResponsibility' ? null : z(m))
    })
    expect(missing.lane).toBeCloseTo(0.5)
  })
  it('无分路：对线缺失，发育 = 伤害/经济比', () => {
    const s = computeSubScores({ hasLanes: false, z })
    expect(s.lane).toBeNull()
    expect(s.growth).toBeCloseTo(0.2)
  })
  it('无时间线（死亡成本缺失）：死亡质量退回 −z(每分钟死亡)', () => {
    const s = computeSubScores({
      hasLanes: true,
      z: m => (m === 'deathCostPerMin' ? null : z(m))
    })
    expect(s.deathQuality).toBeCloseTo(-2)
  })
})

describe('combineSubScores', () => {
  const sub = {
    lane: -0.25,
    teamfight: 0.7 / 3,
    deathQuality: -1.2,
    growth: 0.1,
    resources: 0.6,
    vision: -1
  }
  it('上单：Σ w·分项（视野不在上单组里）', () => {
    const c = combineSubScores(sub, WEIGHTS.TOP)
    expect(c.total).toBeCloseTo(-0.253333, 5)
    expect(c.contributions.lane).toBeCloseTo(-0.075)
    expect(c.contributions.vision).toBeUndefined()
  })
  it('对线缺失：其权重按比例分摊给其余分项', () => {
    const c = combineSubScores({ ...sub, lane: null }, WEIGHTS.TOP)
    expect(c.total).toBeCloseTo(-0.254762, 5)
    expect(c.contributions.deathQuality).toBeCloseTo(-0.428571, 5)
  })
  it('全部缺失：总分 0', () => {
    const none = {
      lane: null,
      teamfight: null,
      deathQuality: null,
      growth: null,
      resources: null,
      vision: null
    }
    expect(combineSubScores(none, WEIGHTS.TOP)).toEqual({ total: 0, contributions: {} })
  })
})
