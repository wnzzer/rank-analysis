/**
 * 关联信号引擎（纯函数）测试：运算符边界 / 数据缺失 / 畸形规则 / 模板占位替换。
 * 目标覆盖率 90%+（工具函数标准）。
 *
 * @module services/ai/shared/signals
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateSignals,
  formatMetric,
  buildSignalSubjects,
  type SignalRule,
  type SignalSubject
} from '../signals'
import type { RecentPlayerProfile } from '../types'

const lossRule: SignalRule = {
  id: 'loser-streak',
  scope: 'teammate',
  whenAll: [{ metric: 'lossStreak', op: 'gte', value: 4 }],
  whenAny: [],
  text: '{name}正在{lossStreak}连败，注意心态与对线保守',
  severity: 'warn'
}

const carryRule: SignalRule = {
  id: 'ice-cold-carry',
  scope: 'enemy',
  whenAll: [
    { metric: 'winRate10', op: 'gte', value: 0.7 },
    { metric: 'games10', op: 'gte', value: 5 }
  ],
  whenAny: [],
  text: '敌方{name}近10场胜率{winRate10}（样本{games10}场），重点盯防',
  severity: 'danger'
}

const rustedRule: SignalRule = {
  id: 'rusted-hand',
  scope: 'teammate',
  position: 'JUNGLE',
  whenAll: [{ metric: 'isOffRole', op: 'eq', value: 1 }],
  whenAny: [],
  text: '{name}本局可能补位，前期多给支援',
  severity: 'info'
}

function subject(overrides: Partial<SignalSubject>): SignalSubject {
  return {
    puuid: 'p1',
    name: 'Tester',
    scope: 'teammate',
    metrics: { lossStreak: 0, winRate10: 0.5, games10: 10, isOffRole: 0, recentKda: 2.0 },
    ...overrides
  }
}

describe('evaluateSignals', () => {
  it('连败≥4 触发 warn 信号并替换占位符', () => {
    const signals = evaluateSignals(
      [subject({ metrics: { ...subject({}).metrics, lossStreak: 4 } })],
      [lossRule]
    )
    expect(signals).toHaveLength(1)
    expect(signals[0].id).toBe('loser-streak')
    expect(signals[0].severity).toBe('warn')
    expect(signals[0].text).toBe('Tester正在4连败，注意心态与对线保守')
    expect(signals[0].evidence).toEqual(['lossStreak=4 (gte 4)'])
  })

  it('连败=3 边界不触发', () => {
    const signals = evaluateSignals(
      [subject({ metrics: { ...subject({}).metrics, lossStreak: 3 } })],
      [lossRule]
    )
    expect(signals).toHaveLength(0)
  })

  it('whenAll 多条件全部满足才触发', () => {
    const good = evaluateSignals(
      [
        subject({
          scope: 'enemy',
          metrics: { ...subject({}).metrics, winRate10: 0.75, games10: 8 }
        })
      ],
      [carryRule]
    )
    expect(good).toHaveLength(1)
    expect(good[0].text).toContain('胜率75%')
    expect(good[0].text).toContain('样本8场')

    const lowSample = evaluateSignals(
      [
        subject({
          scope: 'enemy',
          metrics: { ...subject({}).metrics, winRate10: 0.75, games10: 3 }
        })
      ],
      [carryRule]
    )
    expect(lowSample).toHaveLength(0)
  })

  it('scope 过滤：teammate 规则不作用于 enemy', () => {
    const signals = evaluateSignals(
      [subject({ scope: 'enemy', metrics: { ...subject({}).metrics, lossStreak: 5 } })],
      [lossRule]
    )
    expect(signals).toHaveLength(0)
  })

  it('position 过滤：JUNGLE 规则不作用于其他位置', () => {
    const jungle = evaluateSignals(
      [
        subject({ metrics: { ...subject({}).metrics, isOffRole: 1 }, position: 'JUNGLE' }),
        subject({
          puuid: 'p2',
          name: 'Bot',
          metrics: { ...subject({}).metrics, isOffRole: 1 },
          position: 'BOTTOM'
        })
      ],
      [rustedRule]
    )
    expect(jungle).toHaveLength(1)
    expect(jungle[0].subjectPuuid).toBe('p1')
  })

  it('数据缺失（metrics 为空）不触发任何条件', () => {
    const signals = evaluateSignals([subject({ metrics: {} })], [lossRule, carryRule])
    expect(signals).toHaveLength(0)
  })

  it('未知指标/畸形规则静默跳过不影响其余信号', () => {
    const bad: SignalRule = {
      id: 'bad-metric',
      scope: 'teammate',
      whenAll: [{ metric: 'killParticipation10', op: 'lt', value: 0.45 }],
      whenAny: [],
      text: 'x',
      severity: 'info'
    }
    const badOp: SignalRule = {
      id: 'bad-op',
      scope: 'teammate',
      whenAll: [{ metric: 'lossStreak', op: '~' as never, value: 1 }],
      whenAny: [],
      text: 'y',
      severity: 'info'
    }
    const signals = evaluateSignals(
      [subject({ metrics: { ...subject({}).metrics, lossStreak: 6 } })],
      [bad, badOp, lossRule]
    )
    expect(signals).toHaveLength(1)
    expect(signals[0].id).toBe('loser-streak')
  })

  it('稳定性排序：danger 在 warn 前', () => {
    const signals = evaluateSignals(
      [
        subject({
          scope: 'enemy',
          metrics: { ...subject({}).metrics, winRate10: 0.8, games10: 10 }
        }),
        subject({ metrics: { ...subject({}).metrics, lossStreak: 5 } })
      ],
      [lossRule, carryRule]
    )
    expect(signals.map(s => s.id)).toEqual(['ice-cold-carry', 'loser-streak'])
  })

  it('whenAny 任一满足即命中', () => {
    const anyRule: SignalRule = {
      id: 'either',
      scope: 'teammate',
      whenAll: [],
      whenAny: [
        { metric: 'lossStreak', op: 'gte', value: 4 },
        { metric: 'recentKda', op: 'lte', value: 1.0 }
      ],
      text: '{name} 状态存疑',
      severity: 'warn'
    }
    const viaKda = evaluateSignals(
      [subject({ metrics: { ...subject({}).metrics, recentKda: 0.8 } })],
      [anyRule]
    )
    expect(viaKda).toHaveLength(1)
  })

  it('whenAll 与 whenAny 同时满足时命中', () => {
    const bothRule: SignalRule = {
      id: 'both',
      scope: 'teammate',
      whenAll: [{ metric: 'isOffRole', op: 'eq', value: 1 }],
      whenAny: [{ metric: 'recentKda', op: 'lte', value: 1.5 }],
      text: '{name} 补位+低迷',
      severity: 'warn'
    }
    const signals = evaluateSignals(
      [subject({ metrics: { ...subject({}).metrics, isOffRole: 1, recentKda: 1.2 } })],
      [bothRule]
    )
    expect(signals).toHaveLength(1)
  })
})

describe('formatMetric', () => {
  it('winRate10 渲染为百分数', () => {
    expect(formatMetric('winRate10', 0.7)).toBe('70%')
  })
  it('整数原样，小数保留一位', () => {
    expect(formatMetric('games10', 10)).toBe('10')
    expect(formatMetric('recentKda', 1.2333)).toBe('1.2')
  })
})

describe('buildSignalSubjects', () => {
  function profile(overrides: Partial<RecentPlayerProfile> = {}): RecentPlayerProfile {
    return {
      positionDistribution: [{ pos: 'JUNGLE', ratio: 0.9, games: 9 }],
      mainPosition: 'JUNGLE',
      currentLanePlayedRatio: 0.9,
      championDistribution: [],
      currentChampionMastery: null,
      recentWinRate: 0.5,
      recentKda: 2.0,
      streak: { kind: 'win', count: 1 },
      isOffRole: false,
      offRoleSeverity: 'none',
      ...overrides
    }
  }

  it('按队伍归属与本人标识聚合 scope/position/name', () => {
    const subjects = buildSignalSubjects(
      {
        mySubteamId: 1,
        subteams: [
          {
            subteamId: 1,
            players: [
              { summoner: { puuid: 'me', gameName: 'Self' }, assignedPosition: 'TOP' },
              { summoner: { puuid: 'mate', gameName: 'Buddy' }, assignedPosition: 'JUNGLE' }
            ]
          },
          {
            subteamId: 2,
            players: [{ summoner: { puuid: 'foe', gameName: 'Foe' }, assignedPosition: 'BOTTOM' }]
          }
        ]
      },
      new Map([['mate', profile()]]),
      'me'
    )
    const byPuuid = Object.fromEntries(subjects.map(s => [s.puuid, s]))
    expect(byPuuid['me'].scope).toBe('self')
    expect(byPuuid['mate'].scope).toBe('teammate')
    expect(byPuuid['mate'].position).toBe('JUNGLE')
    expect(byPuuid['mate'].metrics.lossStreak).toBe(0)
    expect(byPuuid['foe'].scope).toBe('enemy')
    // 无画像 → 空指标（不触发规则）
    expect(byPuuid['foe'].metrics).toEqual({})
  })

  it('缺失 puuid 的玩家被跳过', () => {
    const subjects = buildSignalSubjects(
      { mySubteamId: 1, subteams: [{ subteamId: 1, players: [{ championId: 1 }] }] },
      new Map()
    )
    expect(subjects).toHaveLength(0)
  })

  it('连败画像映射为 lossStreak 值', () => {
    const subjects = buildSignalSubjects(
      { mySubteamId: 1, subteams: [{ subteamId: 1, players: [{ summoner: { puuid: 'a' } }] }] },
      new Map([['a', profile({ streak: { kind: 'loss', count: 6 } })]])
    )
    expect(subjects[0].metrics.lossStreak).toBe(6)
    expect(subjects[0].metrics.games10).toBe(9)
  })
})
