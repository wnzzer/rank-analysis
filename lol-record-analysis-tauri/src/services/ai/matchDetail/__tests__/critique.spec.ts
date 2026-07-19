import { describe, it, expect } from 'vitest'

import { buildCritiqueUserPrompt } from '../critique'
import { classifyMode } from '../../shared/modeContext'
import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'

function snapshotForTest(): MatchSnapshot {
  return {
    gameId: 1,
    queueName: '排位',
    queueId: 420,
    gameMode: 'CLASSIC',
    durationSeconds: 1800,
    modeContext: classifyMode(420, 'CLASSIC'),
    teams: [],
    players: [
      { participantId: 1, teamId: 100, name: 'A', teamPosition: 'JUNGLE', recentProfile: null }
    ]
  } as unknown as MatchSnapshot
}

function fakeAttribution(): AttributionResult {
  return {
    winReason: '蓝方运营碾压',
    verdicts: [
      {
        participantId: 1,
        name: 'A',
        label: '尽力',
        evidenceMetrics: [
          { metric: 'kda', value: 5, teamRank: 1 },
          { metric: 'damageShare', value: 35 },
          { metric: 'killParticipation', value: 80 }
        ],
        mitigatingFactors: [],
        finalCall: '伤害 35% 参团 80%'
      }
    ]
  }
}

describe('buildCritiqueUserPrompt', () => {
  it('defaults to 整局锐评 prompt (5 段模板)', () => {
    const prompt = buildCritiqueUserPrompt(fakeAttribution(), snapshotForTest())
    expect(prompt).toContain('## 一句话定论')
    expect(prompt).toContain('蓝方运营碾压')
  })

  it('selects 单人复盘 prompt when mode=player with participantId', () => {
    const prompt = buildCritiqueUserPrompt(fakeAttribution(), snapshotForTest(), {
      mode: 'player',
      participantId: 1
    })
    expect(prompt).toContain('【目标玩家】')
    expect(prompt).toContain('## 一句话定档')
  })

  it('falls back to 整局锐评 when mode=player but participantId missing', () => {
    const prompt = buildCritiqueUserPrompt(fakeAttribution(), snapshotForTest(), {
      mode: 'player'
    })
    expect(prompt).toContain('## 一句话定论')
  })

  it('injects vocab samples into the prompt when provided', () => {
    const prompt = buildCritiqueUserPrompt(fakeAttribution(), snapshotForTest(), {
      vocabSamples: ['抽象', '0换4']
    })
    expect(prompt).toContain('抽象')
    expect(prompt).toContain('0换4')
  })
})
