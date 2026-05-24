import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../stream', () => ({
  requestAIContent: vi.fn(),
  requestAIContentStream: vi.fn(),
  DEFAULT_SYSTEM_PROMPT: 'sys'
}))

import { requestAIContent } from '../../stream'
import { runAttributionStage } from '../attribution'
import { classifyMode } from '../../shared/modeContext'
import type { MatchSnapshot } from '../../shared/snapshot'

const mockRequest = requestAIContent as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockRequest.mockReset()
})

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

describe('runAttributionStage', () => {
  it('returns ok when AI returns valid JSON', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    const out = await runAttributionStage(snapshotForTest())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.verdicts).toHaveLength(4)
      expect(out.rawJson).toBeTruthy()
    }
  })

  it('returns error when AI request fails', async () => {
    mockRequest.mockResolvedValueOnce({ success: false, error: 'network down' })
    const out = await runAttributionStage(snapshotForTest())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('network')
  })

  it('returns error when JSON invalid', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: 'not json' })
    const out = await runAttributionStage(snapshotForTest())
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/json|parse/i)
      expect(out.rawJson).toBe('not json')
    }
  })

  it('uses ranked addon for ranked snapshot (system prompt contains "lane" or "对位")', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    await runAttributionStage(snapshotForTest())
    const userPrompt = mockRequest.mock.calls[0][0] as string
    expect(userPrompt).toContain('对位')
  })

  it('uses aram addon for aram snapshot (does NOT mention 上中下打野辅助)', async () => {
    const aramSnap = {
      ...snapshotForTest(),
      queueId: 450,
      modeContext: classifyMode(450, 'ARAM')
    }
    mockRequest.mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    await runAttributionStage(aramSnap as MatchSnapshot)
    const userPrompt = mockRequest.mock.calls[0][0] as string
    expect(userPrompt).not.toContain('上中下打野辅助')
  })

  it('passes a stable cacheKey including gameId and stage', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    await runAttributionStage(snapshotForTest())
    const cacheKey = mockRequest.mock.calls[0][1] as string
    expect(cacheKey).toContain('1') // gameId
    expect(cacheKey).toMatch(/stage1|attribution/)
  })
})
