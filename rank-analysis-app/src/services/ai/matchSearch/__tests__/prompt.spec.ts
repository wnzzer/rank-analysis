import { describe, it, expect } from 'vitest'
import { buildMatchSearchPrompt } from '../prompt'

const CTX = {
  today: '2026-09-01',
  champions: [
    { value: 51, label: '皮城女警', nickname: '女警 (Caitlyn)', realName: '凯特琳' },
    { value: 222, label: '暴走萝莉', nickname: '金克丝 (Jinx)', realName: '金克丝' }
  ],
  modes: [
    { label: '单双排位', value: 420 },
    { label: '极地大乱斗', value: 450 }
  ]
}

describe('buildMatchSearchPrompt', () => {
  it('user prompt 注入今天日期、英雄清单、模式清单与原文', () => {
    const { user } = buildMatchSearchPrompt('这个月我用女警赢的那把', CTX)
    expect(user).toContain('2026-09-01')
    expect(user).toContain('51|皮城女警|女警 (Caitlyn)|凯特琳')
    expect(user).toContain('420|单双排位')
    expect(user).toContain('这个月我用女警赢的那把')
  })

  it('system prompt 约束:只能用清单内 id、输出 JSON、不确定留空', () => {
    const { system } = buildMatchSearchPrompt('随便', CTX)
    expect(system).toContain('JSON')
    expect(system).toContain('清单')
    expect(system).toContain('myTeamChampionIds')
  })

  it('user prompt 含基于今天的时间换算示例(近30天/近7天)', () => {
    const { user } = buildMatchSearchPrompt('这个月', CTX)
    // 2026-09-01 往前 30 天 = 2026-08-02;往前 7 天 = 2026-08-25
    expect(user).toContain('2026-08-02')
    expect(user).toContain('2026-08-25')
  })
})
