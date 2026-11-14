/**
 * 打分入口：单位基准（所有指标 mean 0 / std 1，z = 原值）下的手算用例，
 * 含 spec 验证 2 的「单线被单杀 ≥3 次、无 gank」构造局。
 */
import { describe, it, expect } from 'vitest'
import type { Baseline } from '../baseline'
import type { AttributedDeath, DeathKind } from '../deathAttribution'
import {
  END_METRICS,
  TIMELINE_METRICS,
  type EndMetricValues,
  type TimelineMetricValues
} from '../metrics'
import { scorePlayers, type PlayerScoringInput, type ScoringData } from '../scorePlayers'
import type { Thresholds } from '../thresholds'

const UNIT: Baseline = {
  meta: { builtAt: '', versions: [], sampleGames: 0, detailsGames: 0, perQueue: {}, note: '' },
  cells: {
    '420|*|*': {
      n: 1000,
      metrics: Object.fromEntries(
        [...END_METRICS, ...TIMELINE_METRICS].map(m => [m, { mean: 0, std: 1 }])
      )
    }
  }
}
const TH: Thresholds = {
  meta: { builtAt: '', sampleGames: 0 },
  cells: {
    '*|*|tl': {
      n: 1000,
      total: [-0.8, -0.5, -0.3, -0.1, 0, 0.15, 0.3, 0.5, 0.8],
      sub: {
        lane: [-1.5, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.5],
        deathQuality: [-1.4, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.4],
        teamfight: [-1.2, -0.8, -0.5, -0.2, 0, 0.2, 0.5, 0.8, 1.2],
        growth: [-1.2, -0.8, -0.5, -0.2, 0, 0.3, 0.5, 0.8, 1.2]
      }
    }
  }
}
const DATA: ScoringData = { baseline: UNIT, thresholds: TH }
const CTX = { queueId: 420, hasLanes: true }
const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const zeroEnd = () => Object.fromEntries(END_METRICS.map(m => [m, 0])) as EndMetricValues
const zeroTl = () => Object.fromEntries(TIMELINE_METRICS.map(m => [m, 0])) as TimelineMetricValues

/** 1-5 蓝方（败）、6-10 红方（胜），全部指标 0、无阵亡 */
function player(pid: number, over: Partial<PlayerScoringInput> = {}): PlayerScoringInput {
  return {
    participantId: pid,
    teamId: pid <= 5 ? 100 : 200,
    win: pid > 5,
    position: POS[(pid - 1) % 5],
    championId: pid,
    end: zeroEnd(),
    timeline: zeroTl(),
    deaths: [],
    ...over
  }
}
const death = (victimId: number, minute: number, kind: DeathKind, r: number): AttributedDeath => ({
  victimId,
  timestamp: minute * 60000,
  kind,
  responsibility: r,
  enemies: 1,
  allies: 1,
  consequence: 1
})
const game = (overrides: Record<number, Partial<PlayerScoringInput>>) =>
  Array.from({ length: 10 }, (_, i) => player(i + 1, overrides[i + 1] ?? {}))

describe('scorePlayers', () => {
  it('构造局：上单对线期被单杀 3 次、无 gank → 犯罪且无减责', () => {
    const players = game({
      1: {
        timeline: {
          ...zeroTl(),
          goldDiff14: -1,
          xpDiff14: -1,
          csDiff14: -1,
          deathCostPerMin: 2,
          laneDeathResponsibility: 3
        },
        deaths: [death(1, 4, 'solo', 1), death(1, 7, 'solo', 1), death(1, 10, 'solo', 1)]
      }
    })
    const s = scorePlayers(players, CTX, DATA)[0]
    // 对线 = mean(−1,−1,−1) + 0.5×(−z(3)) = −1 − 1.5 = −2.5（单位基准：z = 原值）；死亡质量 = −2
    expect(s.sub.lane).toBeCloseTo(-2.5)
    expect(s.sub.deathQuality).toBeCloseTo(-2)
    // 总分 = 0.3×(−2.5) + 0.25×(−2) = −1.25
    expect(s.total).toBeCloseTo(-1.25)
    expect(s.band).toBe('低于 P10')
    expect(s.mitigation.mitigated).toBe(false)
    expect(s.label).toBe('犯罪')
  })

  it('对线阵亡与基准持平（z=0）→ 无惩罚，对线只看三差', () => {
    const players = game({
      1: {
        timeline: { ...zeroTl(), goldDiff14: -1, xpDiff14: -1, csDiff14: -1 },
        deaths: [death(1, 5, 'solo', 1)]
      }
    })
    expect(scorePlayers(players, CTX, DATA)[0].sub.lane).toBeCloseTo(-1)
  })

  it('败方 carry（总分 ≥ P70）→ 被连累；减责证据照常算出', () => {
    const carry: Partial<PlayerScoringInput> = {
      end: {
        ...zeroEnd(),
        killParticipation: 1,
        damagePerGold: 1,
        gpm: 1,
        csm: 1,
        objectiveDamagePerMin: 1
      },
      timeline: { ...zeroTl(), objectiveParticipation: 1 },
      deaths: [death(4, 20, 'ganked', 0.5), death(4, 25, 'collapse', 0.3)]
    }
    const collapsedLane = { timeline: { ...zeroTl(), goldDiff14: -2, xpDiff14: -2, csDiff14: -2 } }
    const s = scorePlayers(game({ 1: collapsedLane, 2: collapsedLane, 4: carry }), CTX, DATA)[3]
    // 下路：0.25×0 + 0.25×0.5 + 0.2×0 + 0.2×1 + 0.1×1 = 0.425
    expect(s.total).toBeCloseTo(0.425)
    expect(s.mitigation.reasons).toEqual([
      '阵亡 2 次中 2 次是被抓或队友先倒下',
      '2 名队友对线明显落后'
    ])
    expect(s.label).toBe('被连累')
  })

  it('同一 carry 没有减责证据 → 仍是被连累（总分 ≥ P70 不需要证据）', () => {
    const carry: Partial<PlayerScoringInput> = {
      end: {
        ...zeroEnd(),
        killParticipation: 1,
        damagePerGold: 1,
        gpm: 1,
        csm: 1,
        objectiveDamagePerMin: 1
      },
      timeline: { ...zeroTl(), objectiveParticipation: 1 },
      deaths: [death(4, 20, 'solo', 1), death(4, 25, 'solo', 1)]
    }
    const s = scorePlayers(game({ 4: carry }), CTX, DATA)[3]
    expect(s.total).toBeCloseTo(0.425)
    expect(s.mitigation.mitigated).toBe(false)
    expect(s.label).toBe('被连累')
  })

  it('构造单线局 + 两名队友对线崩盘 → 被爆（有减责证据不定罪）', () => {
    const collapsedLane = { timeline: { ...zeroTl(), goldDiff14: -2, xpDiff14: -2, csDiff14: -2 } }
    const players = game({
      1: {
        timeline: {
          ...zeroTl(),
          goldDiff14: -1,
          xpDiff14: -1,
          csDiff14: -1,
          deathCostPerMin: 2,
          laneDeathResponsibility: 3
        },
        deaths: [death(1, 4, 'solo', 1), death(1, 7, 'solo', 1), death(1, 10, 'solo', 1)]
      },
      2: collapsedLane,
      3: collapsedLane
    })
    const s = scorePlayers(players, CTX, DATA)[0]
    expect(s.total).toBeCloseTo(-1.25)
    expect(s.mitigation.reasons).toEqual(['2 名队友对线明显落后'])
    expect(s.label).toBe('被爆')
  })

  it('方案 B：败方队内唯一最高（P40~P60）→ 被连累；队内第二 → 正常', () => {
    const players = game({
      3: { end: { ...zeroEnd(), gpm: 0.4, csm: 0.4 } },
      4: { end: { ...zeroEnd(), gpm: 0.5, csm: 0.5 } }
    })
    const out = scorePlayers(players, CTX, DATA)
    // 下路：发育 0.5 × 0.15 = 0.075（P60=0.15 以下、P40=−0.1 以上）；中单：0.4 × 0.15 = 0.06
    expect(out[3].total).toBeCloseTo(0.075)
    expect(out[3].label).toBe('被连累')
    expect(out[2].total).toBeCloseTo(0.06)
    expect(out[2].label).toBe('正常')
  })

  it('无基准队列：退回本局相对比较，总分有限，全员相同（无唯一最高）则全是正常', () => {
    const out = scorePlayers(game({}), { queueId: 9999, hasLanes: true }, DATA)
    for (const s of out) {
      expect(Number.isFinite(s.total)).toBe(true)
      expect(s.label).toBe('正常')
    }
  })

  it('输出顺序 = 输入顺序；同输入两次结果相同（确定性）', () => {
    const players = game({ 3: { end: { ...zeroEnd(), gpm: 2 } } })
    const a = scorePlayers(players, CTX, DATA)
    expect(a.map(s => s.participantId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(scorePlayers(players, CTX, DATA)).toEqual(a)
  })

  it('两名败方并列队内最高（P40~P70）→ 都不是被连累（并列不算唯一最高）', () => {
    const tied: Partial<PlayerScoringInput> = {
      position: 'BOTTOM',
      end: { ...zeroEnd(), gpm: 0.5, csm: 0.5 }
    }
    const out = scorePlayers(game({ 3: tied, 4: tied }), CTX, DATA)
    // 同位置同数值：总分 0.5 × 0.15 = 0.075，落在 P40(−0.1)~P70(0.3) 之间
    expect(out[2].total).toBeCloseTo(0.075)
    expect(out[3].total).toBeCloseTo(0.075)
    expect(out[2].label).toBe('正常')
    expect(out[3].label).toBe('正常')
  })

  it('本队无其他队友时不判队内最高（空真值守卫）', () => {
    // 1 号独自一队（100），其余为 200；1 号败方总分 0 ∈ [P40, P70)
    const players = game({}).map((p, i) => ({ ...p, teamId: i === 0 ? 100 : 200 }))
    const s = scorePlayers(players, CTX, DATA)[0]
    expect(s.total).toBeCloseTo(0)
    expect(s.label).toBe('正常')
  })
})
