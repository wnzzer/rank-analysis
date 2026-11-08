/**
 * 减责证据与标签判定（阈值格手写，期望值手算）。
 * 阈值格 TH：P20 = −0.5、P30 = −0.3、P40 = −0.1、P50 = 0、P60 = 0.15、P70 = 0.3、P80 = 0.5；对线 P10 = −1.5、死亡质量 P10 = −1.4、
 * 团战 P10 = −1.2、发育 P60 = 0.3。
 */
import { describe, it, expect } from 'vitest'
import type { AttributedDeath, DeathKind } from '../deathAttribution'
import { decideLabel, mitigationEvidence, type LabelInput } from '../labels'
import type { ThresholdCell } from '../thresholds'

const d = (kind: DeathKind): AttributedDeath => ({
  victimId: 1,
  timestamp: 0,
  kind,
  responsibility: 1,
  consequence: 1
})

describe('mitigationEvidence', () => {
  it('被抓/队友先崩占比 ≥ 50% 成立', () => {
    const m = mitigationEvidence([d('ganked'), d('collapse'), d('solo'), d('solo')], [])
    expect(m.mitigated).toBe(true)
    expect(m.reasons).toEqual(['阵亡 4 次中 2 次是被抓或队友先倒下'])
  })
  it('占比不足 50% 不成立', () => {
    expect(mitigationEvidence([d('ganked'), d('solo'), d('solo')], []).mitigated).toBe(false)
  })
  it('≥2 名队友对线分 < −1.0 成立', () => {
    const m = mitigationEvidence(null, [-1.2, -1.5, 0.3, null])
    expect(m.mitigated).toBe(true)
    expect(m.reasons).toEqual(['2 名队友对线明显落后'])
    expect(mitigationEvidence(null, [-1.2, 0.3]).mitigated).toBe(false)
  })
  it('无阵亡、无时间线都不成立', () => {
    expect(mitigationEvidence([], []).mitigated).toBe(false)
    expect(mitigationEvidence(null, []).mitigated).toBe(false)
  })
})

const TH: ThresholdCell = {
  n: 1000,
  total: [-0.8, -0.5, -0.3, -0.1, 0, 0.15, 0.3, 0.5, 0.8],
  sub: {
    lane: [-1.5, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.5],
    deathQuality: [-1.4, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.4],
    teamfight: [-1.2, -0.8, -0.5, -0.2, 0, 0.2, 0.5, 0.8, 1.2],
    growth: [-1.2, -0.8, -0.5, -0.2, 0, 0.3, 0.5, 0.8, 1.2]
  }
}
const NONE = {
  lane: null,
  teamfight: null,
  deathQuality: null,
  growth: null,
  resources: null,
  vision: null
}
const base: LabelInput = {
  win: false,
  hasTimeline: true,
  total: 0,
  sub: NONE,
  thresholds: TH,
  mitigated: false,
  teamBest: false
}

describe('decideLabel', () => {
  it('尽力：胜方且总分 ≥ P80', () => {
    expect(decideLabel({ ...base, win: true, total: 0.6 })).toBe('尽力')
    expect(decideLabel({ ...base, win: true, total: 0.4 })).toBe('正常')
  })

  it('被连累：败方且总分 ≥ P70，不需要减责证据', () => {
    expect(decideLabel({ ...base, total: 0.35 })).toBe('被连累')
    expect(decideLabel({ ...base, total: 0.35, mitigated: true, sub: { ...NONE, lane: -2 } })).toBe(
      '被连累'
    )
    expect(decideLabel({ ...base, total: 0.2 })).toBe('正常')
  })

  it('被连累（方案 B）：本队唯一最高且 ≥ P40', () => {
    // P45：−0.05 落在 P40(−0.1)~P50(0)
    expect(decideLabel({ ...base, total: -0.05, teamBest: true })).toBe('被连累')
    // P35：−0.2 落在 P30(−0.3)~P40(−0.1)，队内最高也不够
    expect(decideLabel({ ...base, total: -0.2, teamBest: true })).toBe('正常')
    // 队内第二、P60~P70：不是被连累
    expect(decideLabel({ ...base, total: 0.2, teamBest: false })).toBe('正常')
    // 队内第二但 ≥ P70：被连累
    expect(decideLabel({ ...base, total: 0.35, teamBest: false })).toBe('被连累')
    // 胜方队内最高不适用
    expect(decideLabel({ ...base, win: true, total: -0.05, teamBest: true })).toBe('正常')
  })

  it('被爆：总分 < P70、对线或死亡质量 ≤ P10、减责证据成立（胜方也可）', () => {
    expect(decideLabel({ ...base, total: -0.9, mitigated: true, sub: { ...NONE, lane: -2 } })).toBe(
      '被爆'
    )
    expect(
      decideLabel({
        ...base,
        win: true,
        total: 0,
        mitigated: true,
        sub: { ...NONE, deathQuality: -1.5 }
      })
    ).toBe('被爆')
  })

  it('犯罪：败方、总分 ≤ P30、无减责证据', () => {
    expect(decideLabel({ ...base, total: -0.6 })).toBe('犯罪')
    expect(decideLabel({ ...base, total: -0.2 })).toBe('正常')
  })

  it('低分但有减责证据、分项没到 P10：既不被爆也不犯罪 → 正常', () => {
    expect(decideLabel({ ...base, total: -0.9, mitigated: true, sub: { ...NONE, lane: -1 } })).toBe(
      '正常'
    )
  })

  it('缚地灵：团战 ≤ P10 且发育 ≥ P60', () => {
    expect(
      decideLabel({
        ...base,
        win: true,
        total: 0.1,
        sub: { ...NONE, teamfight: -1.3, growth: 0.5 }
      })
    ).toBe('缚地灵')
  })

  it('分项阈值缺失时分项条件不成立', () => {
    const bare = { ...TH, sub: {} }
    expect(
      decideLabel({
        ...base,
        thresholds: bare,
        total: -0.6,
        mitigated: true,
        sub: { ...NONE, lane: -3 }
      })
    ).toBe('正常')
  })
})

describe('标签边界与规则互斥', () => {
  it('total === P80 且胜 → 尽力', () => {
    expect(decideLabel({ ...base, win: true, total: 0.5 })).toBe('尽力')
  })

  it('total === P70 且败 → 被连累', () => {
    expect(decideLabel({ ...base, total: 0.3 })).toBe('被连累')
  })

  it('total === P70 且胜、对线 ≤ P10、有减责 → 正常（不是被爆）', () => {
    expect(
      decideLabel({ ...base, win: true, total: 0.3, mitigated: true, sub: { ...NONE, lane: -1.5 } })
    ).toBe('正常')
  })

  it('total === P40 且败、队内最高 → 被连累', () => {
    expect(decideLabel({ ...base, total: -0.1, teamBest: true })).toBe('被连累')
  })

  it('有时间线：total === P30 → 犯罪；略高 → 正常；略低 → 犯罪', () => {
    expect(decideLabel({ ...base, total: -0.3 })).toBe('犯罪')
    expect(decideLabel({ ...base, total: -0.29 })).toBe('正常')
    expect(decideLabel({ ...base, total: -0.31 })).toBe('犯罪')
  })

  it('无时间线：total === P20 → 犯罪；略高 → 正常；略低 → 犯罪（P30 在此不够）', () => {
    const nt = { ...base, hasTimeline: false }
    expect(decideLabel({ ...nt, total: -0.5 })).toBe('犯罪')
    expect(decideLabel({ ...nt, total: -0.49 })).toBe('正常')
    expect(decideLabel({ ...nt, total: -0.51 })).toBe('犯罪')
    expect(decideLabel({ ...nt, total: -0.3 })).toBe('正常')
  })

  it('对线 === P10 算低分 → 被爆（有减责、total < P70）', () => {
    expect(
      decideLabel({ ...base, total: -0.9, mitigated: true, sub: { ...NONE, lane: -1.5 } })
    ).toBe('被爆')
  })

  it('死亡质量 === P10 算低分 → 被爆（有减责、total < P70）', () => {
    expect(
      decideLabel({ ...base, total: -0.9, mitigated: true, sub: { ...NONE, deathQuality: -1.4 } })
    ).toBe('被爆')
  })

  it('团战 === P10 且发育 === P60 → 缚地灵', () => {
    expect(decideLabel({ ...base, total: 0, sub: { ...NONE, teamfight: -1.2, growth: 0.3 } })).toBe(
      '缚地灵'
    )
  })

  it('队友对线分恰为 −1.0 不计入证据 2（严格小于）', () => {
    expect(mitigationEvidence(null, [-1, -1, 0.3]).mitigated).toBe(false)
    expect(mitigationEvidence(null, [-1.01, -1.5, -1]).mitigated).toBe(true)
  })

  it('胜方 P70 ≤ total < P80 即使满足被爆条件 → 正常', () => {
    expect(
      decideLabel({ ...base, win: true, total: 0.4, mitigated: true, sub: { ...NONE, lane: -2 } })
    ).toBe('正常')
  })

  it('胜方 total ≤ P30 且无减责 → 不是犯罪（犯罪只判败方）', () => {
    expect(decideLabel({ ...base, win: true, total: -0.3, mitigated: false })).toBe('正常')
  })

  it('败方 P30 < total < P70、对线 ≤ P10、无减责 → 正常', () => {
    expect(decideLabel({ ...base, total: -0.2, sub: { ...NONE, lane: -1.5 } })).toBe('正常')
  })

  it('缚地灵只满足一个条件 → 不是缚地灵', () => {
    expect(decideLabel({ ...base, total: 0, sub: { ...NONE, teamfight: -1.2 } })).toBe('正常')
    expect(decideLabel({ ...base, total: 0, sub: { ...NONE, growth: 0.3 } })).toBe('正常')
  })

  it('败方队内最高且 ≥ P40，同时满足被爆条件 → 被连累（先判被连累）', () => {
    expect(
      decideLabel({
        ...base,
        total: -0.05,
        teamBest: true,
        mitigated: true,
        sub: { ...NONE, lane: -2 }
      })
    ).toBe('被连累')
  })
})
