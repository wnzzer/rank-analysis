/**
 * 指标定义：终局指标（手算期望值）与时间线指标（构造时间线）。
 */
import { describe, it, expect } from 'vitest'
import { frame, input, pf } from '../../timeline/__tests__/helpers'
import type { SlimEvent } from '../../timeline/types'
import type { AttributedDeath } from '../deathAttribution'
import { endMetrics, timelineMetrics } from '../metrics'

const MIN = 60000

describe('endMetrics', () => {
  it('30 分钟一局的各项（手算）', () => {
    const m = endMetrics({
      durationSec: 1800,
      kills: 6,
      deaths: 3,
      assists: 9,
      teamKills: 30,
      damageToChampions: 24000,
      gold: 12000,
      cs: 210,
      visionScore: 30,
      objectiveDamage: 6000,
      ccSeconds: 45
    })
    expect(m).toEqual({
      dpm: 800,
      gpm: 400,
      csm: 7,
      kda: 5,
      killParticipation: 0.5,
      deathsPerMin: 0.1,
      visionPerMin: 1,
      damagePerGold: 2,
      objectiveDamagePerMin: 200,
      ccPerMin: 1.5
    })
  })

  it('缺失字段为 null；0 死亡 KDA 按 1 死计；队伍 0 击杀参团率按 1 计', () => {
    const m = endMetrics({
      durationSec: 600,
      kills: 0,
      deaths: 0,
      assists: 0,
      teamKills: 0,
      damageToChampions: 0,
      gold: 0,
      cs: 0,
      visionScore: null,
      objectiveDamage: null,
      ccSeconds: null
    })
    expect(m.kda).toBe(0)
    expect(m.killParticipation).toBe(0)
    expect(m.visionPerMin).toBeNull()
    expect(m.objectiveDamagePerMin).toBeNull()
    expect(m.ccPerMin).toBeNull()
    expect(m.damagePerGold).toBeNull()
  })
})

const T20 = 20 * MIN
const kill = (timestamp: number, victimId: number, killerId: number): SlimEvent => ({
  type: 'CHAMPION_KILL',
  timestamp,
  killerId,
  victimId,
  assisting: [],
  x: 7000,
  y: 7000,
  bounty: 300,
  shutdownBounty: 0,
  damageReceived: []
})
const ward = (timestamp: number, creatorId: number, wardType: string): SlimEvent => ({
  type: 'WARD_PLACED',
  timestamp,
  creatorId,
  wardType
})
const fightPos = [
  ...[1, 2, 3, 6, 7, 8].map(id => pf(id, { x: 7000, y: 7000 })),
  pf(9, { x: 14000, y: 14000 }),
  pf(10, { x: 14000, y: 14000 })
]
const tl = {
  frames: [
    frame(14 * MIN, [
      pf(1, { totalGold: 6000, xp: 7000, cs: 110 }),
      pf(6, { totalGold: 5000, xp: 6500, cs: 100 })
    ]),
    frame(T20, fightPos),
    frame(21 * MIN, fightPos)
  ],
  events: [
    ward(MIN, 5, 'CONTROL_WARD'),
    ward(2 * MIN, 5, 'CONTROL_WARD'),
    ward(3 * MIN, 5, 'SIGHT_WARD'),
    kill(T20, 6, 1),
    kill(T20 + 5000, 7, 2),
    kill(T20 + 10000, 8, 3),
    {
      type: 'ELITE_MONSTER_KILL' as const,
      timestamp: T20 + 30000,
      killerId: 2,
      killerTeamId: 100,
      monsterType: 'DRAGON',
      monsterSubType: '',
      x: 9866,
      y: 4414
    }
  ]
}
const deaths: AttributedDeath[] = [
  { victimId: 6, timestamp: T20, kind: 'fight', enemies: 1, responsibility: 0.6, consequence: 2 }
]

describe('timelineMetrics', () => {
  const m = timelineMetrics(input(tl), deaths, 1500)

  it('14 分钟对位差', () => {
    expect([m[1].goldDiff14, m[1].xpDiff14, m[1].csDiff14]).toEqual([1000, 500, 10])
    expect([m[6].goldDiff14, m[6].xpDiff14, m[6].csDiff14]).toEqual([-1000, -500, -10])
    expect(m[2].goldDiff14).toBe(0)
  })

  it('死亡成本/分钟 = Σ(责任×后果)/分钟', () => {
    expect(m[6].deathCostPerMin).toBeCloseTo(0.048)
    expect(m[1].deathCostPerMin).toBe(0)
  })

  it('对线期阵亡责任 = 14 分钟前阵亡的责任之和（20 分钟的死不计）', () => {
    const early: AttributedDeath[] = [
      {
        victimId: 1,
        timestamp: 5 * MIN,
        kind: 'solo',
        enemies: 1,
        responsibility: 1,
        consequence: 1
      },
      {
        victimId: 1,
        timestamp: 10 * MIN,
        kind: 'ganked',
        enemies: 1,
        responsibility: 0.5,
        consequence: 1
      },
      {
        victimId: 1,
        timestamp: 20 * MIN,
        kind: 'solo',
        enemies: 1,
        responsibility: 1,
        consequence: 1
      }
    ]
    const e = timelineMetrics(input(tl), [...deaths, ...early], 1500)
    expect(e[1].laneDeathResponsibility).toBeCloseTo(1.5)
    expect(e[6].laneDeathResponsibility).toBe(0)
  })

  it('缺位搭档按分担计入死亡成本与对线期阵亡责任', () => {
    const roam: AttributedDeath = {
      victimId: 4,
      timestamp: 6 * MIN,
      kind: 'isolated',
      enemies: 2,
      responsibility: 0.7,
      absentPartner: { participantId: 5, share: 0.3 },
      consequence: 2
    }
    const e = timelineMetrics(input(tl), [roam], 1500)
    expect(e[4].deathCostPerMin).toBeCloseTo((0.7 * 2) / 25)
    expect(e[5].deathCostPerMin).toBeCloseTo((0.3 * 2) / 25)
    expect(e[5].laneDeathResponsibility).toBeCloseTo(0.3)
    expect(e[3].deathCostPerMin).toBe(0)
  })

  it('团战缺席率与团内先死率', () => {
    expect(m[1].fightAbsenceRate).toBe(0)
    expect(m[4].fightAbsenceRate).toBe(1)
    expect(m[9].fightAbsenceRate).toBe(1)
    expect(m[6].fightFirstDeathRate).toBe(1)
    expect(m[7].fightFirstDeathRate).toBe(0)
    expect(m[1].fightFirstDeathRate).toBe(0)
  })

  it('己方野怪参与率（击杀者或在 2500 码内）；己方没拿野怪为 null', () => {
    expect(m[2].objectiveParticipation).toBe(1)
    expect(m[1].objectiveParticipation).toBe(0)
    expect(m[6].objectiveParticipation).toBeNull()
  })

  it('控制守卫/分钟', () => {
    expect(m[5].controlWardsPerMin).toBeCloseTo(0.08)
    expect(m[1].controlWardsPerMin).toBe(0)
  })

  it('无分路：对位差为 null', () => {
    const noLane = timelineMetrics(input(tl, { hasLanes: false }), deaths, 1500)
    expect(noLane[1].goldDiff14).toBeNull()
  })

  it('无团战：团战两项为 null', () => {
    const quiet = timelineMetrics(input({ frames: tl.frames, events: [] }), [], 1500)
    expect(quiet[1].fightAbsenceRate).toBeNull()
    expect(quiet[1].fightFirstDeathRate).toBeNull()
  })
})
