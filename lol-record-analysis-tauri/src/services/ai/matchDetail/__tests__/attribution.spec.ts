import { describe, it, expect } from 'vitest'

import {
  buildAttributionUserPrompt,
  parseAttribution,
  stage1CacheKey,
  STAGE1_MODEL
} from '../attribution'
import { classifyMode } from '../../shared/modeContext'
import type { MatchSnapshot } from '../../shared/snapshot'

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
      { participantId: 1, teamId: 100, name: 'A', recentProfile: null },
      { participantId: 2, teamId: 100, name: 'B', recentProfile: null },
      { participantId: 3, teamId: 200, name: 'C', recentProfile: null },
      { participantId: 4, teamId: 200, name: 'D', recentProfile: null }
    ]
  } as unknown as MatchSnapshot
}

function fakeAttributionJson(): string {
  return JSON.stringify({
    winReason: '蓝方运营碾压',
    verdicts: [1, 2, 3, 4].map(id => ({
      participantId: id,
      name: `P${id}`,
      label: '正常',
      evidenceMetrics: [
        { metric: 'kda', value: 2 },
        { metric: 'damageShare', value: 20 },
        { metric: 'killParticipation', value: 50 }
      ],
      mitigatingFactors: [],
      finalCall: '数据中位，没什么好说的'
    }))
  })
}

describe('buildAttributionUserPrompt', () => {
  it('uses ranked addon for ranked snapshot (prompt contains "对位")', () => {
    const prompt = buildAttributionUserPrompt(snapshotForTest())
    expect(prompt).toContain('对位')
  })

  it('uses aram addon for aram snapshot (does NOT mention 上中下打野辅助)', () => {
    const aramSnap = {
      ...snapshotForTest(),
      queueId: 450,
      modeContext: classifyMode(450, 'ARAM')
    } as MatchSnapshot
    const prompt = buildAttributionUserPrompt(aramSnap)
    expect(prompt).not.toContain('上中下打野辅助')
  })
})

describe('stage1CacheKey', () => {
  it('is stable and includes gameId / stage / mode kind / model', () => {
    const key = stage1CacheKey(snapshotForTest())
    expect(key).toContain('1') // gameId
    expect(key).toMatch(/stage1|attribution/)
    expect(key).toContain('ranked')
    // 模型变更时缓存键必须跟着变，避免旧模型产物污染新模型
    expect(key).toContain(STAGE1_MODEL)
  })
})

describe('parseAttribution', () => {
  it('returns ok with backfilled verdicts for valid JSON', () => {
    const out = parseAttribution(fakeAttributionJson(), snapshotForTest())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.verdicts).toHaveLength(4)
    }
  })

  it('returns error for invalid JSON', () => {
    const out = parseAttribution('not json', snapshotForTest())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/json|parse/i)
  })
})
