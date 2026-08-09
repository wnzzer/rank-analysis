import { describe, it, expect } from 'vitest'
import { buildStage2SystemPrompt, buildStage2UserPrompt } from '../../prompts/stage2-naming'
import type { ProfileSummary } from '../../types'

const sampleProfile: ProfileSummary = {
  styleSummary: '该玩家擅长野区控制 + 高 KDA。',
  modeBreakdown: [
    {
      queueIds: [420, 440],
      queueName: '单双排位',
      winSignals: ['KDA 高'],
      lossSignals: ['对线崩'],
      sampleSize: 12
    }
  ],
  goodCandidates: [
    {
      id: 'g1',
      metric: 'kda',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 4.5,
      countMin: 5,
      evidence: '排位 KDA≥4.5 共 6 局',
      vibe: ['carry']
    }
  ],
  badCandidates: [
    {
      id: 'b1',
      metric: 'streak',
      queueIds: [420, 440],
      direction: 'loss',
      threshold: 0,
      countMin: 3,
      evidence: '近 3 场连败',
      vibe: ['暮气']
    }
  ]
}

describe('buildStage2SystemPrompt', () => {
  it('declares role as 锐评命名师', () => {
    const p = buildStage2SystemPrompt(sampleProfile, ['雕花匠'], [])
    expect(p).toContain('锐评命名师')
  })

  it('embeds the styleSummary', () => {
    const p = buildStage2SystemPrompt(sampleProfile, ['雕花匠'], [])
    expect(p).toContain('该玩家擅长野区控制')
  })

  it('embeds the sampled vocab list', () => {
    const p = buildStage2SystemPrompt(sampleProfile, ['屠夫', '夜枭'], [])
    expect(p).toContain('屠夫')
    expect(p).toContain('夜枭')
  })

  it('embeds the recently-used names as 禁用词', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], ['雕花匠', '佛系'])
    expect(p).toContain('雕花匠')
    expect(p).toContain('佛系')
    expect(p).toContain('禁用词')
  })

  it('embeds permanent banned names', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).toContain('送葬人')
    expect(p).toContain('carry王')
    expect(p).toContain('演员王')
    expect(p).toContain('送人头')
  })

  it('mentions 不人身攻击 red line', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).toContain('不人身攻击')
  })

  it('declares name 2-7 char range', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).toContain('2-7')
  })

  it('declares desc 10-30 char range', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).toContain('10-30')
  })

  it('reminds AI desc must match queueName precisely', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).toContain('queueName')
  })

  it('declares output JSON shape', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).toContain('"good"')
    expect(p).toContain('"bad"')
    expect(p).toContain('"skipped"')
  })

  it('does NOT contain the full TagCondition schema (Stage 2 only names)', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).not.toContain('MatchFilter')
    expect(p).not.toContain('MatchRefresh')
    expect(p).not.toContain('"type":"and"')
  })

  it('contains good and bad tone guidance', () => {
    const p = buildStage2SystemPrompt(sampleProfile, [], [])
    expect(p).toContain('好标签')
    expect(p).toContain('坏标签')
  })
})

describe('buildStage2UserPrompt', () => {
  it('serializes profile candidates as JSON', () => {
    const p = buildStage2UserPrompt(sampleProfile)
    expect(p).toContain('goodCandidates')
    expect(p).toContain('badCandidates')
    expect(p).toContain('"id":"g1"')
    expect(p).toContain('"id":"b1"')
  })

  it('does NOT re-embed the styleSummary (already in system)', () => {
    const p = buildStage2UserPrompt(sampleProfile)
    // styleSummary text should not appear in user prompt
    expect(p).not.toContain('该玩家擅长野区控制')
  })
})
