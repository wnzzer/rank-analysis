import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../stream', () => ({
  requestAIContent: vi.fn(),
  requestAIContentStream: vi.fn(),
  DEFAULT_SYSTEM_PROMPT: 'sys'
}))

import { requestAIContentStream } from '../../stream'
import { runCritiqueStage } from '../critique'
import { classifyMode } from '../../shared/modeContext'
import type { MatchSnapshot } from '../../shared/snapshot'
import type { AttributionResult } from '../types'

const mockStream = requestAIContentStream as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockStream.mockReset()
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
    players: []
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

describe('runCritiqueStage', () => {
  it('streams chunks and returns ok markdown on success', async () => {
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('## 一句话定论\n')
      callbacks.onChunk('蓝方碾压。\n')
      callbacks.onDone()
    })
    const chunks: string[] = []
    const out = await runCritiqueStage(snapshotForTest(), fakeAttribution(), {
      onChunk: c => chunks.push(c),
      onDone: () => {},
      onError: () => {}
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.markdown).toContain('一句话定论')
      expect(out.markdown).toContain('蓝方碾压')
    }
    expect(chunks).toEqual(['## 一句话定论\n', '蓝方碾压。\n'])
  })

  it('falls back to template on stream error', async () => {
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onError('stream broke')
    })
    const out = await runCritiqueStage(snapshotForTest(), fakeAttribution(), {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {}
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.fallbackMarkdown).toContain('## 一句话定论')
      expect(out.fallbackMarkdown).toContain('蓝方运营碾压')
    }
  })

  it('forwards onChunk during streaming', async () => {
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('hello')
      callbacks.onDone()
    })
    const chunks: string[] = []
    await runCritiqueStage(snapshotForTest(), fakeAttribution(), {
      onChunk: c => chunks.push(c),
      onDone: () => {},
      onError: () => {}
    })
    expect(chunks).toEqual(['hello'])
  })

  it('injects vocab samples into the prompt when provided', async () => {
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('ok')
      callbacks.onDone()
    })
    await runCritiqueStage(
      snapshotForTest(),
      fakeAttribution(),
      { onChunk: () => {}, onDone: () => {}, onError: () => {} },
      { vocabSamples: ['抽象', '0换4'] }
    )
    const userPrompt = mockStream.mock.calls[0][0] as string
    expect(userPrompt).toContain('抽象')
    expect(userPrompt).toContain('0换4')
  })
})
