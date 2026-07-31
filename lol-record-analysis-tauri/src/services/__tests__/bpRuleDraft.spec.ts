import { describe, it, expect } from 'vitest'
import { buildRuleDraft } from '../bpRuleDraft'
import type { BpDecision } from '@renderer/types/bpDecision'
import type { PickRule, BanRule } from '@renderer/types/rules'

const championName = (id: number) => ({ 64: '盲僧', 157: '亚索', 60: '豹女' })[id] ?? `英雄${id}`

function decision(overrides: Partial<BpDecision> = {}): BpDecision {
  return {
    action_type: 'Pick',
    target: {
      champion_id: 64,
      lock: true,
      origin: { type: 'Fallback', pool_size: 3 },
      evidence: null
    },
    rejected: [],
    mode: 'Advisory',
    time_left_secs: 20,
    execute_at_secs_left: 5,
    user_overridden: false,
    ...overrides
  }
}

describe('buildRuleDraft', () => {
  it('优先用 evidence 的克制来源作为敌方条件', () => {
    const r = buildRuleDraft({
      decision: decision({
        target: {
          champion_id: 64,
          lock: true,
          origin: { type: 'Fallback', pool_size: 3 },
          evidence: { win_rate: 0.447, against_champion_id: 60 }
        }
      }),
      myPosition: 'jungle',
      laneOpponentId: 157,
      championName
    }) as PickRule

    expect(r.conditions).toEqual([
      { type: 'Position', value: 'jungle' },
      { type: 'EnemyChampionsContains', ids: [60] }
    ])
    expect(r.name).toBe('打野 · 对位豹女')
    expect(r.action).toEqual({ champion_id: 64, lock: true })
    expect(r.enabled).toBe(true)
    expect(r.id).toBeTruthy()
  })

  it('无 evidence 时退回同分路对位英雄', () => {
    const r = buildRuleDraft({
      decision: decision(),
      myPosition: 'jungle',
      laneOpponentId: 157,
      championName
    }) as PickRule

    expect(r.conditions).toEqual([
      { type: 'Position', value: 'jungle' },
      { type: 'EnemyChampionsContains', ids: [157] }
    ])
    expect(r.name).toBe('打野 · 对位亚索')
  })

  it('两者都无时只留位置条件并在名字里标注', () => {
    const r = buildRuleDraft({
      decision: decision(),
      myPosition: 'jungle',
      laneOpponentId: null,
      championName
    }) as PickRule

    expect(r.conditions).toEqual([{ type: 'Position', value: 'jungle' }])
    expect(r.name).toBe('打野 · 仅位置')
  })

  it('无分路（ARAM）时条件为空但仍可保存', () => {
    const r = buildRuleDraft({
      decision: decision(),
      myPosition: null,
      laneOpponentId: null,
      championName
    }) as PickRule

    expect(r.conditions).toEqual([])
    expect(r.name).toBe('盲僧 · 无条件')
  })

  it('ban 决策生成 BanRule，action 不含 lock', () => {
    const r = buildRuleDraft({
      decision: decision({
        action_type: 'Ban',
        target: {
          champion_id: 157,
          lock: true,
          origin: { type: 'Fallback', pool_size: 2 },
          evidence: null
        }
      }),
      myPosition: 'middle',
      laneOpponentId: 60,
      championName
    }) as BanRule

    expect(r.action).toEqual({ champion_id: 157 })
    expect('lock' in r.action).toBe(false)
  })

  it('保留规则的 lock=false（只 hover 不锁定）', () => {
    const r = buildRuleDraft({
      decision: decision({
        target: {
          champion_id: 64,
          lock: false,
          origin: { type: 'Rule', rule_id: 'r1', rule_name: 'x' },
          evidence: null
        }
      }),
      myPosition: 'jungle',
      laneOpponentId: null,
      championName
    }) as PickRule

    expect(r.action).toEqual({ champion_id: 64, lock: false })
  })

  it('target 为 null 时返回 null', () => {
    expect(
      buildRuleDraft({
        decision: decision({ target: null }),
        myPosition: 'jungle',
        laneOpponentId: null,
        championName
      })
    ).toBeNull()
  })
})
