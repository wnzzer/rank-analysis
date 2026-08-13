import { describe, it, expect } from 'vitest'
import { assembleAnalysisReport, validateCritiqueReport } from '../critiqueReport'
import type { AttributionResult } from '../types'

function makeAttribution(overrides: Partial<AttributionResult> = {}): AttributionResult {
  return {
    winReason: '蓝方运营碾压',
    verdicts: [
      {
        participantId: 1,
        name: 'P1#0000',
        champion: '赏金猎人',
        teamPosition: 'BOTTOM',
        teamResult: '胜方',
        label: '尽力',
        evidenceMetrics: [
          { metric: 'damageShare', value: 32 },
          { metric: 'kda', value: 5.2 }
        ],
        mitigatingFactors: [],
        finalCall: '伤害 32%，扛起整局'
      },
      {
        participantId: 2,
        name: 'P2#0000',
        champion: '疾风剑豪',
        teamPosition: 'MIDDLE',
        teamResult: '败方',
        label: '犯罪',
        evidenceMetrics: [
          { metric: 'deaths', value: 9 },
          { metric: 'damageShare', value: 14 }
        ],
        mitigatingFactors: [],
        finalCall: '死亡 9 次'
      },
      {
        participantId: 3,
        name: 'P3#0000',
        champion: '影流之主',
        teamPosition: 'TOP',
        teamResult: '败方',
        label: '被爆',
        evidenceMetrics: [
          { metric: 'deathsBefore5', value: 4 },
          { metric: 'csDiffAt10', value: -18 }
        ],
        mitigatingFactors: [],
        finalCall: '对线期被单杀 2 次'
      },
      {
        participantId: 4,
        name: 'P4#0000',
        champion: '光辉女郎',
        teamPosition: 'UTILITY',
        teamResult: '胜方',
        label: '正常',
        evidenceMetrics: [{ metric: 'killParticipation', value: 70 }],
        mitigatingFactors: [],
        finalCall: '数据中位'
      }
    ],
    ...overrides
  }
}

const attribution = makeAttribution()

describe('validateCritiqueReport', () => {
  it('parses plain JSON object', () => {
    const out = validateCritiqueReport('{"oneLiner":"蓝方碾压。","verdict":"win"}')
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.oneLiner).toBe('蓝方碾压。')
    }
  })

  it('strips ```json fenced wrapper', () => {
    const out = validateCritiqueReport('```json\n{"oneLiner":"目测是 F5。"}\n```')
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.oneLiner).toBe('目测是 F5。')
    }
  })

  it('rejects non-JSON garbage', () => {
    const out = validateCritiqueReport('## 谁尽力了\n- 模型摆烂了')
    expect(out.ok).toBe(false)
  })

  it('rejects empty / structureless object', () => {
    expect(validateCritiqueReport('{}').ok).toBe(false)
    expect(validateCritiqueReport('{"comments":123}').ok).toBe(false)
  })

  it('accepts comments-only draft', () => {
    const out = validateCritiqueReport('{"comments":{"1":"打野节奏拉满"}}')
    expect(out.ok).toBe(true)
  })
})

describe('assembleAnalysisReport', () => {
  it('分组确定性来自 Stage 1 label，模型 comments 只填文案', () => {
    const report = assembleAnalysisReport(attribution, {
      verdict: 'win',
      oneLiner: '蓝方运营碾压。',
      comments: {
        '1': '下路 C 王，伤害 32% 全场第一',
        '2': '死亡 9 次，妥妥深渊领航员'
      },
      evidence: ['P1 伤害占比 32% 全场第一']
    })
    expect(report.verdict).toBe('win')
    expect(report.oneLiner).toBe('蓝方运营碾压。')
    expect(report.mvps).toEqual([{ participantId: 1, reason: '下路 C 王，伤害 32% 全场第一' }])
    expect(report.sunkCosts).toEqual([{ participantId: 2, reason: '死亡 9 次，妥妥深渊领航员' }])
    expect(report.crushed).toEqual([{ participantId: 3, reason: '对线期被单杀 2 次' }])
    expect(report.evidence).toEqual(['P1 伤害占比 32% 全场第一'])
  })

  it('normal/未上榜玩家不进任何分组', () => {
    const report = assembleAnalysisReport(attribution, { oneLiner: 'x' })
    expect(report.mvps).toHaveLength(1)
    expect(report.sunkCosts).toHaveLength(1)
    expect(report.crushed).toHaveLength(1)
    expect(report.mvps.some(p => p.participantId === 4)).toBe(false)
    expect(report.sunkCosts.some(p => p.participantId === 4)).toBe(false)
  })

  it('comment 缺失时回退归因 finalCall', () => {
    const report = assembleAnalysisReport(attribution, { oneLiner: 'x' })
    expect(report.mvps[0].reason).toBe('伤害 32%，扛起整局')
    expect(report.sunkCosts[0].reason).toBe('死亡 9 次')
  })

  it('模型 verdict 非法时归一为 neutral', () => {
    const report = assembleAnalysisReport(attribution, { oneLiner: 'x' })
    expect(report.verdict).toBe('neutral')
  })

  it('draft 无 evidence 时用 teamRank 极端指标兜底', () => {
    const report = assembleAnalysisReport(attribution, { oneLiner: 'x' })
    expect(report.evidence.length).toBeGreaterThan(0)
    // P2 的 deaths teamRank 无 1/5 标记则走第二层逐条兜底，至少非空
    expect(report.evidence.every(e => typeof e === 'string' && e.length > 0)).toBe(true)
  })

  it('单人扩展字段：评分与改进建议只在合法时装配', () => {
    const report = assembleAnalysisReport(attribution, {
      oneLiner: 'x',
      rating: 12,
      metrics: ['KDA 5.2 全场第一', '伤害 32%'],
      improvements: [{ title: '减少无意义游走', evidence: '死亡 9 次', suggestion: '优先推线' }]
    })
    expect(report.ownScore).toBeUndefined()
    expect(report.improvements).toEqual([
      { title: '减少无意义游走', evidence: '死亡 9 次', suggestion: '优先推线' }
    ])
  })

  it('improvements 过滤缺 title 项并截断 3 条', () => {
    const report = assembleAnalysisReport(attribution, {
      oneLiner: 'x',
      improvements: [
        { title: 'a', suggestion: '1' },
        { title: '', suggestion: '无标题应被过滤' },
        { title: 'b', suggestion: '2' },
        { title: 'c', suggestion: '3' },
        { title: 'd', suggestion: '4' }
      ]
    })
    expect(report.improvements).toHaveLength(3)
    expect(report.improvements?.some(i => i.title === '')).toBe(false)
  })
})
