import { describe, it, expect } from 'vitest'
import { renderFallbackCritique } from '../critiqueTemplate'
import type { AttributionResult } from '../types'

const sample: AttributionResult = {
  winReason: '蓝方运营优势滚雪球，红方下路 10 分钟崩盘',
  verdicts: [
    {
      participantId: 1,
      name: '主玩A',
      label: '尽力',
      evidenceMetrics: [
        { metric: 'kda', value: 5.2, teamRank: 1 },
        { metric: 'damageShare', value: 32 }
      ],
      mitigatingFactors: [],
      finalCall: '伤害 32% 参团 75% 扛起整局'
    },
    {
      participantId: 2,
      name: '主玩B',
      label: '犯罪',
      evidenceMetrics: [
        { metric: 'kda', value: 0.8, teamRank: 5 },
        { metric: 'killParticipation', value: 22 }
      ],
      mitigatingFactors: [],
      finalCall: 'KDA 0.8 参团 22% 拖了整局'
    },
    {
      participantId: 3,
      name: '主玩C',
      label: '被爆',
      evidenceMetrics: [{ metric: 'deaths', value: 11 }],
      mitigatingFactors: [{ factor: 'off-role', support: 'isOffRole=true' }],
      finalCall: '死 11 次，但在补位'
    }
  ]
}

describe('renderFallbackCritique', () => {
  it('contains all 5 template sections', () => {
    const md = renderFallbackCritique(sample)
    expect(md).toContain('## 一句话定论')
    expect(md).toContain('## 谁尽力了')
    expect(md).toContain('## 谁要背锅')
    expect(md).toContain('## 谁被打爆')
    expect(md).toContain('## 关键证据')
  })

  it('includes winReason in 一句话定论', () => {
    const md = renderFallbackCritique(sample)
    expect(md).toContain('蓝方运营优势滚雪球')
  })

  it('lists 尽力 verdicts under 谁尽力了', () => {
    const md = renderFallbackCritique(sample)
    const section = md.split('## 谁尽力了')[1].split('## ')[0]
    expect(section).toContain('主玩A')
  })

  it('lists 犯罪 verdicts under 谁要背锅', () => {
    const md = renderFallbackCritique(sample)
    const section = md.split('## 谁要背锅')[1].split('## ')[0]
    expect(section).toContain('主玩B')
  })

  it('lists 被爆 / 被连累 / 缚地灵 under 谁被打爆', () => {
    const md = renderFallbackCritique(sample)
    const section = md.split('## 谁被打爆')[1].split('## ')[0]
    expect(section).toContain('主玩C')
  })

  it('mentions mitigating factor "在补位" when off-role present', () => {
    const md = renderFallbackCritique(sample)
    expect(md).toMatch(/补位|非主玩位置/)
  })

  it('shows fallback message when no 尽力 verdict', () => {
    const noEffort: AttributionResult = {
      winReason: 'X',
      verdicts: sample.verdicts.filter(v => v.label !== '尽力')
    }
    const md = renderFallbackCritique(noEffort)
    const section = md.split('## 谁尽力了')[1].split('## ')[0]
    expect(section).toMatch(/混子局|无人尽力|没人称得上/)
  })

  it('produces concise but readable markdown (length > 80)', () => {
    const md = renderFallbackCritique(sample)
    expect(md.length).toBeGreaterThan(80)
  })
})
