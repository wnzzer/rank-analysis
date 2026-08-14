/**
 * 成长报告 prompt 单元测试
 *
 * 回归重点：
 * - 三部分任务框架存在且顺序正确（状态 → 问题 → 下一步）
 * - 趋势事实块完整覆盖后端聚合字段（KDA/胜率/参团率/补刀/视野/经济/伤害）
 * - 纪律区硬规则（只引用/不编造/无数据不分析/150 字）
 * - 样本不足时仍有「窗口」事实但保持纪律
 */
import { describe, it, expect } from 'vitest'
import { buildGrowthReportPrompt, growthTrendText } from '../growthReport'
import type { RecentData } from '@renderer/types/domain/analysis'

function recent(overrides: Partial<RecentData> = {}): RecentData {
  return {
    kda: 3.2,
    kills: 6.5,
    deaths: 4.1,
    assists: 7.8,
    wins: 0,
    losses: 0,
    selectMode: 420,
    selectModeCn: '单双排',
    selectWins: 6,
    selectLosses: 4,
    flexWins: 0,
    flexLosses: 0,
    groupRate: 55,
    averageGold: 13200,
    goldRate: 21,
    averageDamageDealtToChampions: 20480,
    damageDealtToChampionsRate: 24,
    samples: 10,
    averageCsPerMin: 6.8,
    averageVisionScore: 27.4,
    oneGamePlayers: {},
    friendAndDispute: {
      friendsRate: 0,
      disputeRate: 0,
      friendsSummoner: [],
      disputeSummoner: []
    },
    ...overrides
  }
}

describe('buildGrowthReportPrompt', () => {
  it('应包含三部分任务框架（状态/问题/下一步）', () => {
    const prompt = buildGrowthReportPrompt(recent())
    expect(prompt).toContain('状态一句话')
    expect(prompt).toContain('最大问题')
    expect(prompt).toContain('下一步')
  })

  it('趋势事实块应覆盖全部后端聚合字段且不改写数字', () => {
    const text = growthTrendText(recent({ selectWins: 6, selectLosses: 4 }))
    expect(text).toContain('近 10 场')
    expect(text).toContain('单双排')
    expect(text).toContain('6 胜 4 负')
    expect(text).toContain('60.0%）')
    expect(text).toContain('6.5/4.1/7.8')
    expect(text).toContain('kda=3.2')
    expect(text).toContain('参团率：55%')
    expect(text).toContain('补刀速率：6.8 CS/分钟')
    expect(text).toContain('视野得分：27.4')
    expect(text).toContain('13k 金币')
    expect(text).toContain('金币占比 21%')
    expect(text).toContain('伤害占比 24%')
  })

  it('样本不足时仍输出窗口事实并保留纪律区', () => {
    const prompt = buildGrowthReportPrompt(recent({ samples: 0, selectWins: 0, selectLosses: 0 }))
    expect(prompt).toContain('近 0 场')
    expect(prompt).toContain('（0.0%）')
    expect(prompt).toContain('分析纪律')
  })

  it('纪律区必须是硬规则（只引用/不编造/无数据不分析/150 字）', () => {
    const prompt = buildGrowthReportPrompt(recent())
    expect(prompt).toContain('只能引用与解释')
    expect(prompt).toContain('禁止改写数字')
    expect(prompt).toContain('禁止自创数据')
    expect(prompt).toContain('没有数据的维度')
    expect(prompt).toContain('150 字以内')
  })
})
