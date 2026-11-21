import { describe, it, expect } from 'vitest'
import {
  autoTargetOf,
  countdownOf,
  damageTypeOf,
  effectiveHoverId,
  toPanelView
} from '@renderer/services/bpPanelView'
import type { BpPanelSnapshot, BpSnapshotCandidate } from '@renderer/types/bpPanel'

const deps = { name: (id: number) => `英雄${id}`, icon: (id: number) => `/icon/${id}` }

function candidate(overrides: Partial<BpSnapshotCandidate> = {}): BpSnapshotCandidate {
  return {
    champion_id: 103,
    score: 0.555,
    in_pool: true,
    physical_share: 0.1,
    games: 12,
    wins: 8,
    unfamiliar: false,
    reasons: [],
    warning: null,
    ...overrides
  }
}

function snapshot(overrides: Partial<BpPanelSnapshot> = {}): BpPanelSnapshot {
  return {
    action_type: 'Pick',
    stage: 'Acting',
    candidates: [candidate()],
    auto_target_id: null,
    hovered_id: 0,
    overridden: false,
    time_left_secs: 20,
    total_secs: 27,
    execute_at_secs_left: 5,
    ally_mix: { physical: 1.8, magic: 0.2, known: 2 },
    enemy_mix: { physical: 0, magic: 0, known: 0 },
    result_champion_id: 0,
    ...overrides
  }
}

describe('damageTypeOf', () => {
  it('should bucket physical share into three damage types', () => {
    expect(damageTypeOf(0.9)).toBe('physical')
    expect(damageTypeOf(0.1)).toBe('magic')
    expect(damageTypeOf(0.5)).toBe('mixed')
  })

  it('should treat unknown damage as mixed', () => {
    expect(damageTypeOf(null)).toBe('mixed')
  })
})

describe('toPanelView', () => {
  it('should format a pick card with win rate and mastery', () => {
    const view = toPanelView(snapshot(), deps)

    expect(view.action).toBe('pick')
    expect(view.stage).toBe('acting')
    expect(view.candidates[0]).toMatchObject({
      championId: 103,
      name: '英雄103',
      icon: '/icon/103',
      headline: '55.5%',
      caption: '评估胜率',
      mastery: '近期 12 场 67%',
      damage: 'magic',
      inPool: true
    })
  })

  it('should say never played when there are no recent games', () => {
    const view = toPanelView(
      snapshot({ candidates: [candidate({ games: 0, wins: 0, unfamiliar: true })] }),
      deps
    )

    expect(view.candidates[0].mastery).toBe('没玩过')
    expect(view.candidates[0].unfamiliar).toBe(true)
  })

  it('should format a ban card as threat score without mastery', () => {
    const view = toPanelView(
      snapshot({ action_type: 'Ban', candidates: [candidate({ score: 94.6, games: 0 })] }),
      deps
    )

    expect(view.action).toBe('ban')
    expect(view.candidates[0].headline).toBe('95')
    expect(view.candidates[0].caption).toBe('威胁度')
    expect(view.candidates[0].mastery).toBeUndefined()
  })

  it('should turn backend reasons into labelled reasons', () => {
    const reason = (kind: string, extra: object = {}) => ({
      kind,
      champion_id: 0,
      delta: null,
      tier: 0,
      ban_rate: null,
      ...extra
    })
    const view = toPanelView(
      snapshot({
        candidates: [
          candidate({
            reasons: [
              reason('Meta', { tier: 2, delta: 1.5 }),
              reason('Mastery', { delta: -2 }),
              reason('Counters', { champion_id: 238, delta: 3 }),
              reason('CounteredBy', { champion_id: 7, delta: -3 }),
              reason('Risk', { delta: -0.5 }),
              reason('CompSkew', { delta: -1 }),
              reason('CompFill')
            ] as BpSnapshotCandidate['reasons']
          })
        ]
      }),
      deps
    )

    expect(view.candidates[0].reasons).toEqual([
      { kind: 'meta', label: '版本 T2', delta: 1.5 },
      { kind: 'mastery', label: '不熟练', delta: -2 },
      { kind: 'counter', label: '克制英雄238', delta: 3 },
      { kind: 'counter', label: '被英雄7克制', delta: -3 },
      { kind: 'risk', label: '先手风险', delta: -0.5 },
      { kind: 'comp', label: '阵容偏科', delta: -1 },
      { kind: 'comp', label: '补魔法伤害', delta: undefined }
    ])
  })

  it('should label ban reasons with ban rate and the pick being threatened', () => {
    const view = toPanelView(
      snapshot({
        action_type: 'Ban',
        candidates: [
          candidate({
            reasons: [
              { kind: 'Meta', champion_id: 0, delta: null, tier: 1, ban_rate: 0.314 },
              { kind: 'ThreatToPick', champion_id: 103, delta: -4.2, tier: 0, ban_rate: null }
            ]
          })
        ]
      }),
      deps
    )

    expect(view.candidates[0].reasons).toEqual([
      { kind: 'meta', label: 'T1 · Ban 率 31%', delta: undefined },
      { kind: 'counter', label: '克制你的英雄103', delta: -4.2 }
    ])
  })

  it('should translate comp warnings', () => {
    const view = toPanelView(
      snapshot({
        candidates: [
          candidate({ warning: 'LackMagic' }),
          candidate({ champion_id: 90, warning: 'LackPhysical' })
        ]
      }),
      deps
    )

    expect(view.candidates.map(c => c.warning)).toEqual([
      '选它全队缺魔法伤害',
      '选它全队缺物理伤害'
    ])
  })

  it('should add the hovered pick to the ally damage mix', () => {
    const view = toPanelView(snapshot({ hovered_id: 103 }), deps)

    expect(view.allyMix.known).toBe(3)
    expect(view.allyMix.physical).toBeCloseTo(1.9)
    expect(view.allyMix.magic).toBeCloseTo(1.1)
  })

  it('should leave the ally mix alone during ban', () => {
    const view = toPanelView(snapshot({ action_type: 'Ban', hovered_id: 103 }), deps)

    expect(view.allyMix).toEqual({ physical: 1.8, magic: 0.2, known: 2 })
  })

  it('should name the locked champion when done', () => {
    const view = toPanelView(
      snapshot({ stage: 'Done', candidates: [], result_champion_id: 103 }),
      deps
    )

    expect(view.stage).toBe('done')
    expect(view.resultName).toBe('英雄103')
  })

  it('should not treat a panel click as takeover', () => {
    const view = toPanelView(snapshot({ auto_target_id: 238 }), deps, {
      hoverId: 103,
      confirmed: false
    })

    expect(view.hoveredId).toBe(103)
    expect(view.overridden).toBe(false)
    // 自动化照常执行，只是执行的是刚点的英雄
    expect(view.autoTargetId).toBe(103)
  })

  it('should stop promising auto execution once the user confirmed', () => {
    const view = toPanelView(snapshot({ auto_target_id: 103 }), deps, {
      hoverId: 103,
      confirmed: true
    })

    expect(view.overridden).toBe(true)
  })

  it('should report takeover decided by the backend', () => {
    expect(toPanelView(snapshot({ overridden: true }), deps).overridden).toBe(true)
  })
})

describe('autoTargetOf', () => {
  it('should follow the panel click when automation is on', () => {
    expect(autoTargetOf(snapshot({ auto_target_id: 238 }), 103)).toBe(103)
  })

  it('should stay empty when automation is off', () => {
    expect(autoTargetOf(snapshot({ auto_target_id: null }), 103)).toBeNull()
  })

  it('should wait for the backend when the clicked champion is not a candidate yet', () => {
    expect(autoTargetOf(snapshot({ auto_target_id: 238 }), 999)).toBe(238)
  })

  it('should keep the backend target without a local click', () => {
    expect(autoTargetOf(snapshot({ auto_target_id: 238 }), null)).toBe(238)
  })
})

describe('effectiveHoverId', () => {
  it('should prefer the local click over the client hover', () => {
    expect(effectiveHoverId(snapshot({ hovered_id: 103 }), 90, true)).toBe(90)
  })

  it('should fall back to the client hover', () => {
    expect(effectiveHoverId(snapshot({ hovered_id: 103 }), null, false)).toBe(103)
  })

  it('should show the auto target while acting and not overridden', () => {
    const s = snapshot({ auto_target_id: 238 })

    expect(effectiveHoverId(s, null, false)).toBe(238)
    expect(effectiveHoverId(s, null, true)).toBeNull()
    expect(effectiveHoverId({ ...s, stage: 'Waiting' }, null, false)).toBeNull()
  })
})

describe('countdownOf', () => {
  it('should count down to auto execution while auto is active', () => {
    expect(countdownOf(snapshot(), true)).toEqual({ secsLeft: 15, totalSecs: 22 })
  })

  it('should count down to the end of the turn otherwise', () => {
    expect(countdownOf(snapshot(), false)).toEqual({ secsLeft: 20, totalSecs: 27 })
  })

  it('should never go negative', () => {
    expect(countdownOf(snapshot({ time_left_secs: 2 }), true).secsLeft).toBe(0)
  })
})
