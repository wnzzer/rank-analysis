import { describe, it, expect } from 'vitest'
import { buildStage1Prompt } from '../prompts/stage1-attribution'
import { classifyMode } from '../../shared/modeContext'
import type { MatchSnapshot } from '../../shared/snapshot'

function makeSnapshot(opts: { queueId?: number; gameMode?: string } = {}): MatchSnapshot {
  const modeContext = classifyMode(opts.queueId ?? 420, opts.gameMode ?? 'CLASSIC')
  return {
    gameId: 1,
    queueName: '测试模式',
    queueId: opts.queueId ?? 420,
    gameMode: opts.gameMode ?? 'CLASSIC',
    durationSeconds: 1800,
    modeContext,
    teams: [],
    players: []
  } as unknown as MatchSnapshot
}

describe('buildStage1Prompt — common skeleton', () => {
  const snap = makeSnapshot()

  it('injects modeContext.description', () => {
    const prompt = buildStage1Prompt(snap, '')
    expect(prompt).toContain(snap.modeContext.description)
  })

  it('mentions hasLanes / hasItemBuild / championAssignment flags', () => {
    const prompt = buildStage1Prompt(snap, '')
    expect(prompt).toContain('hasLanes')
    expect(prompt).toContain('hasItemBuild')
    expect(prompt).toContain('championAssignment')
  })

  it('lists the six labels and quantified criteria', () => {
    const prompt = buildStage1Prompt(snap, '')
    expect(prompt).toContain('尽力')
    expect(prompt).toContain('犯罪')
    expect(prompt).toContain('被爆')
    expect(prompt).toContain('被连累')
    expect(prompt).toContain('缚地灵')
    expect(prompt).toContain('正常')
  })

  it('documents the TS-precomputed flags', () => {
    const prompt = buildStage1Prompt(snap, '')
    expect(prompt).toContain('isOffRole')
    expect(prompt).toContain('offRoleSeverity')
    expect(prompt).toContain('isFirstTimeInRecent')
    expect(prompt).toContain('isOnetrick')
  })

  it('declares whom to issue verdicts about (4-7 verdicts)', () => {
    const prompt = buildStage1Prompt(snap, '')
    expect(prompt).toContain('4-7')
    expect(prompt).toContain('击杀')
    expect(prompt).toContain('死亡')
    expect(prompt).toContain('isMe')
  })

  it('appends the mode addon rules at the end', () => {
    const prompt = buildStage1Prompt(snap, '【MODE_RULES_MARKER】')
    expect(prompt).toContain('【MODE_RULES_MARKER】')
    // addon should appear after the JSON schema section
    expect(prompt.indexOf('【MODE_RULES_MARKER】')).toBeGreaterThan(
      prompt.indexOf('"verdicts"')
    )
  })

  it('serializes the snapshot as JSON for the model', () => {
    const prompt = buildStage1Prompt(snap, '')
    expect(prompt).toContain('"queueId"')
    expect(prompt).toContain('"modeContext"')
  })
})

import * as rankedPrompt from '../prompts/ranked'

describe('ranked addon', () => {
  it('mentions lane / 对位 / 路位', () => {
    expect(rankedPrompt.rules).toContain('lane')
    expect(rankedPrompt.rules).toContain('对位')
  })

  it('enables item build evaluation', () => {
    expect(rankedPrompt.rules).toContain('装备')
  })

  it('mentions champion counter (with constraint)', () => {
    expect(rankedPrompt.rules).toContain('克制')
  })

  it('mentions isOffRole handling for lane matchup', () => {
    expect(rankedPrompt.rules).toContain('isOffRole')
  })
})

import * as aramPrompt from '../prompts/aram'

describe('aram addon', () => {
  it('does NOT mention 上中下打野辅助', () => {
    expect(aramPrompt.rules).not.toContain('上中下打野辅助')
  })

  it('does NOT mention BP', () => {
    expect(aramPrompt.rules).not.toContain('BP')
  })

  it('does NOT mention 补位', () => {
    expect(aramPrompt.rules).not.toContain('补位')
  })

  it('focuses on teamfight participation', () => {
    expect(aramPrompt.rules).toContain('参团')
  })

  it('mentions damageShare / damageTakenShare', () => {
    expect(aramPrompt.rules).toContain('damageShare')
    expect(aramPrompt.rules).toContain('damageTakenShare')
  })

  it('mentions multiKills as evidence', () => {
    expect(aramPrompt.rules).toContain('multiKills')
  })
})

import * as augmentPrompt from '../prompts/augment'

describe('augment addon', () => {
  it('does NOT mention 装备走向 / 出装顺序', () => {
    expect(augmentPrompt.rules).not.toContain('装备走向')
    expect(augmentPrompt.rules).not.toContain('出装顺序')
  })

  it('does NOT mention 上中下打野辅助', () => {
    expect(augmentPrompt.rules).not.toContain('上中下打野辅助')
  })

  it('does NOT mention BP / 英雄选择', () => {
    expect(augmentPrompt.rules).not.toContain('BP')
  })

  it('focuses on augments coherence', () => {
    expect(augmentPrompt.rules).toContain('augments')
    expect(augmentPrompt.rules).toContain('强化')
  })

  it('mentions augments[] length 6', () => {
    expect(augmentPrompt.rules).toContain('6')
  })

  it('mentions 2v2 / isTeamMode evaluation when team mode', () => {
    expect(augmentPrompt.rules).toContain('isTeamMode')
    expect(augmentPrompt.rules).toContain('2v2')
  })
})

import { buildStage2Prompt } from '../prompts/stage2-critique'
import type { AttributionResult } from '../types'

describe('buildStage2Prompt', () => {
  const sampleAttribution: AttributionResult = {
    winReason: '蓝方运营优势滚雪球',
    verdicts: [
      {
        participantId: 1,
        name: '测试玩家',
        label: '尽力',
        evidenceMetrics: [
          { metric: 'kda', value: 5.2 },
          { metric: 'damageShare', value: 32 },
          { metric: 'killParticipation', value: 75 }
        ],
        mitigatingFactors: [],
        finalCall: '伤害 32%，参团 75%，扛起整局'
      }
    ]
  }

  it('injects modeContext.description', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain(snap.modeContext.description)
  })

  it('embeds attribution JSON', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('蓝方运营优势滚雪球')
    expect(prompt).toContain('测试玩家')
  })

  it('includes the strict markdown template section headers', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('## 一句话定论')
    expect(prompt).toContain('## 谁尽力了')
    expect(prompt).toContain('## 谁要背锅')
    expect(prompt).toContain('## 谁被打爆')
    expect(prompt).toContain('## 关键证据')
  })

  it('forbids 辱骂 / 地域黑 / 人身攻击', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toContain('辱骂')
    expect(prompt).toContain('地域黑')
    expect(prompt).toContain('人身攻击')
  })

  it('injects vocab samples when provided', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, ['抽象', '丝血反杀', '0换4'])
    expect(prompt).toContain('抽象')
    expect(prompt).toContain('丝血反杀')
    expect(prompt).toContain('0换4')
  })

  it('falls back to 自由发挥 hint when vocab is empty', () => {
    const snap = makeSnapshot()
    const prompt = buildStage2Prompt(sampleAttribution, snap, [])
    expect(prompt).toMatch(/自由发挥|无固定词库/)
  })
})
