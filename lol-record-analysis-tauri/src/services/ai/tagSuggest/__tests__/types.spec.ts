import { describe, it, expect } from 'vitest'
import type {
  Candidate,
  ProfileSummary,
  NamingResult,
  NamingEntry,
  ModeBreakdown,
  MetricName
} from '../types'
import { ALLOWED_METRICS, isAllowedMetric } from '../types'

describe('tagSuggest internal types', () => {
  it('ALLOWED_METRICS contains the 15 metric whitelist', () => {
    expect(ALLOWED_METRICS).toContain('kda')
    expect(ALLOWED_METRICS).toContain('kills')
    expect(ALLOWED_METRICS).toContain('deaths')
    expect(ALLOWED_METRICS).toContain('damage')
    expect(ALLOWED_METRICS).toContain('dpm')
    expect(ALLOWED_METRICS).toContain('gold')
    expect(ALLOWED_METRICS).toContain('gpm')
    expect(ALLOWED_METRICS).toContain('cs')
    expect(ALLOWED_METRICS).toContain('csm')
    expect(ALLOWED_METRICS).toContain('killParticipation')
    expect(ALLOWED_METRICS).toContain('damageShare')
    expect(ALLOWED_METRICS).toContain('damageTakenShare')
    expect(ALLOWED_METRICS).toContain('wardScore')
    expect(ALLOWED_METRICS).toContain('multiKillsMax')
    expect(ALLOWED_METRICS).toContain('streak')
  })

  it('isAllowedMetric narrows the type', () => {
    expect(isAllowedMetric('kda')).toBe(true)
    expect(isAllowedMetric('bogus')).toBe(false)
  })

  it('Candidate type compiles with all required fields', () => {
    const c: Candidate = {
      id: 'g1',
      metric: 'kda',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 4.5,
      countMin: 5,
      evidence: '排位 KDA≥4.5 共 6 局',
      vibe: ['carry', '输出型']
    }
    expect(c.id).toBe('g1')
  })

  it('streak candidate uses direction win|loss not operator', () => {
    const c: Candidate = {
      id: 'b1',
      metric: 'streak',
      queueIds: [420, 440],
      direction: 'loss',
      threshold: 0,
      countMin: 3,
      evidence: '近 3 场连败',
      vibe: ['暮气']
    }
    expect(c.direction).toBe('loss')
  })

  it('ProfileSummary type has all the spec fields', () => {
    const ps: ProfileSummary = {
      styleSummary: '该玩家擅长野区控制',
      modeBreakdown: [
        {
          queueIds: [420, 440],
          queueName: '单双排位',
          winSignals: ['KDA 高'],
          lossSignals: ['对线崩'],
          sampleSize: 12
        }
      ],
      goodCandidates: [],
      badCandidates: []
    }
    expect(ps.modeBreakdown[0].sampleSize).toBe(12)
  })

  it('NamingResult has good / bad / skipped', () => {
    const nr: NamingResult = {
      good: [{ id: 'g1', name: '雕花匠', desc: '排位 KDA≥4.5 至少 5 局' }],
      bad: [],
      skipped: ['g2']
    }
    expect(nr.good[0].name).toBe('雕花匠')
    expect(nr.skipped).toContain('g2')
  })

  it('NamingEntry type allows construction', () => {
    const n: NamingEntry = { id: 'x', name: '名字', desc: '描述描述描述' }
    expect(n.id).toBe('x')
  })

  it('MetricName type is the union of allowed metrics', () => {
    const m: MetricName = 'kda'
    expect(m).toBe('kda')
  })

  it('ModeBreakdown sample structure', () => {
    const mb: ModeBreakdown = {
      queueIds: [450],
      queueName: '大乱斗',
      winSignals: [],
      lossSignals: [],
      sampleSize: 8
    }
    expect(mb.queueName).toBe('大乱斗')
  })
})
