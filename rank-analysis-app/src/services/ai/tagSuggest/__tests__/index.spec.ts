import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@renderer/services/ai/stream', () => ({
  requestAIContent: vi.fn(),
  requestAIContentStream: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { requestAIContent, requestAIContentStream } from '@renderer/services/ai/stream'
import {
  requestTagSuggestions,
  markAdopted,
  getCacheKey,
  __resetModuleStateForTests
} from '../index'
import { readRecentNames } from '../vocab/deduplicator'

const mockInvoke = invoke as ReturnType<typeof vi.fn>
const mockRequest = requestAIContent as ReturnType<typeof vi.fn>
const mockStream = requestAIContentStream as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockInvoke.mockReset()
  mockRequest.mockReset()
  mockStream.mockReset()
  sessionStorage.clear()
  __resetModuleStateForTests()
})

// ─── fixtures ─────────────────────────────────────────────────────────────────

function rawGameOf(opts: { win?: boolean; queueId?: number } = {}) {
  return {
    gameId: Math.random(),
    queueId: opts.queueId ?? 420,
    gameDuration: 1800,
    participants: [
      {
        championId: 64,
        teamId: 100,
        teamPosition: 'JUNGLE',
        spell1Id: 4,
        spell2Id: 11,
        stats: {
          win: opts.win ?? true,
          kills: 8,
          deaths: 4,
          assists: 12,
          totalDamageDealtToChampions: 25000,
          goldEarned: 14000,
          totalMinionsKilled: 150,
          neutralMinionsKilled: 50,
          totalDamageTaken: 22000,
          visionScore: 20,
          doubleKills: 0,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0
        }
      }
    ],
    participantIdentities: [{ player: { puuid: 'me' } }]
  }
}

function defaultInvokeImpl(cmd: string) {
  if (cmd === 'get_my_summoner') return { puuid: 'me' }
  if (cmd === 'get_game_modes') {
    return [
      { label: '单双排位', value: 420 },
      { label: '灵活组排', value: 440 },
      { label: '大乱斗', value: 450 }
    ]
  }
  if (cmd === 'get_match_history_by_puuid') {
    const games = [
      ...Array(10)
        .fill(0)
        .map(() => rawGameOf({ win: true })),
      ...Array(10)
        .fill(0)
        .map(() => rawGameOf({ win: false }))
    ]
    return { games: { games } }
  }
  return null
}

const stage1Output = {
  styleSummary: '稳健野区核心',
  modeBreakdown: [
    {
      queueIds: [420, 440],
      queueName: '单双排位',
      winSignals: ['KDA 高'],
      lossSignals: ['对线崩'],
      sampleSize: 10
    }
  ],
  goodCandidates: [
    {
      id: 'g1',
      metric: 'kda',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 3,
      countMin: 5,
      evidence: '',
      vibe: ['carry']
    },
    {
      id: 'g2',
      metric: 'damage',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 20000,
      countMin: 5,
      evidence: '',
      vibe: ['输出']
    },
    {
      id: 'g3',
      metric: 'kda',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 5,
      countMin: 5,
      evidence: '',
      vibe: []
    },
    {
      id: 'g4',
      metric: 'damage',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 25000,
      countMin: 5,
      evidence: '',
      vibe: []
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
      evidence: '',
      vibe: ['暮气']
    },
    {
      id: 'b2',
      metric: 'deaths',
      queueIds: [420, 440],
      direction: '>=',
      threshold: 8,
      countMin: 5,
      evidence: '',
      vibe: ['翻车']
    },
    {
      id: 'b3',
      metric: 'kda',
      queueIds: [420, 440],
      direction: '<=',
      threshold: 1,
      countMin: 5,
      evidence: '',
      vibe: []
    },
    {
      id: 'b4',
      metric: 'streak',
      queueIds: [420, 440],
      direction: 'loss',
      threshold: 0,
      countMin: 4,
      evidence: '',
      vibe: []
    }
  ]
}

const stage2Output = {
  good: [
    { id: 'g1', name: '雕花匠', desc: '排位 KDA≥3 至少 5 局' },
    { id: 'g2', name: '夜枭', desc: '排位伤害高 至少 5 局' },
    { id: 'g3', name: '佛系输出位', desc: '排位高 KDA 至少 5 局' }
  ],
  bad: [
    { id: 'b1', name: '暮气', desc: '排位近 3 场连败' },
    { id: 'b2', name: '翻车王', desc: '排位高死亡 至少 5 局' },
    { id: 'b3', name: '咸鱼', desc: '排位低 KDA 至少 5 局' }
  ],
  skipped: ['g4', 'b4']
}

function mockHappyPath() {
  mockInvoke.mockImplementation(async (cmd: string) => defaultInvokeImpl(cmd))
  mockRequest.mockResolvedValue({
    success: true,
    content: JSON.stringify(stage1Output)
  })
  mockStream.mockImplementation(async (_userPrompt, callbacks: any) => {
    callbacks.onChunk(JSON.stringify(stage2Output))
    callbacks.onDone()
  })
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('requestTagSuggestions — happy path', () => {
  it('returns ok with stitched TagSuggestion entries', async () => {
    mockHappyPath()
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.result.good).toHaveLength(3)
    expect(r.result.bad).toHaveLength(3)
    expect(r.result.good[0].name).toBe('雕花匠')
    expect(r.result.good[0].condition.type).toBe('history')
  })

  it('writes used names to dedup LRU', async () => {
    mockHappyPath()
    await requestTagSuggestions()
    const usedNames = readRecentNames('me')
    expect(usedNames).toContain('雕花匠')
    expect(usedNames).toContain('暮气')
  })

  it('cache hit on second call skips AI', async () => {
    mockHappyPath()
    await requestTagSuggestions()
    mockRequest.mockClear()
    mockStream.mockClear()
    const r2 = await requestTagSuggestions()
    expect(r2.kind).toBe('ok')
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('forceRefresh skips cache and re-invokes AI', async () => {
    mockHappyPath()
    await requestTagSuggestions()
    mockRequest.mockClear()
    mockStream.mockClear()
    mockRequest.mockResolvedValue({
      success: true,
      content: JSON.stringify(stage1Output)
    })
    mockStream.mockImplementation(async (_p, cb: any) => {
      cb.onChunk(JSON.stringify(stage2Output))
      cb.onDone()
    })
    const r2 = await requestTagSuggestions(true)
    expect(r2.kind).toBe('ok')
    expect(mockRequest).toHaveBeenCalled()
    expect(mockStream).toHaveBeenCalled()
  })

  it('passes recentlyUsedNames into Stage 2 prompt', async () => {
    mockHappyPath()
    await requestTagSuggestions() // first call seeds dedup
    let stage2SystemPrompt = ''
    mockStream.mockImplementation(async (_p, cb: any, sys: string) => {
      stage2SystemPrompt = sys
      cb.onChunk(JSON.stringify(stage2Output))
      cb.onDone()
    })
    await requestTagSuggestions(true) // second call should see dedup
    expect(stage2SystemPrompt).toContain('雕花匠') // from prior batch
  })
})

describe('requestTagSuggestions — failure modes', () => {
  it('insufficient features → insufficient outcome', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_my_summoner') return { puuid: 'me' }
      if (cmd === 'get_game_modes') return []
      if (cmd === 'get_match_history_by_puuid') return { games: { games: [rawGameOf()] } } // only 1 game
      return null
    })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('insufficient')
  })

  it('Stage 1 AI failure → aiError', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => defaultInvokeImpl(cmd))
    mockRequest.mockResolvedValue({ success: false, error: 'network down' })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('aiError')
    if (r.kind === 'aiError') expect(r.error).toContain('network')
  })

  it('Stage 1 parse error → parseError', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => defaultInvokeImpl(cmd))
    mockRequest.mockResolvedValue({ success: true, content: 'not json' })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('parseError')
  })

  it('Stage 2 stream error → aiError', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => defaultInvokeImpl(cmd))
    mockRequest.mockResolvedValue({
      success: true,
      content: JSON.stringify(stage1Output)
    })
    mockStream.mockImplementation(async (_p, cb: any) => {
      cb.onError('stream died')
    })
    const r = await requestTagSuggestions()
    expect(r.kind).toBe('aiError')
  })
})

describe('markAdopted', () => {
  it('flips adopted=true on the matching id in the cache', async () => {
    mockHappyPath()
    const r = await requestTagSuggestions()
    if (r.kind !== 'ok') throw new Error('expected ok')
    const id = r.result.good[0].id
    markAdopted('me', id)
    const cached = JSON.parse(sessionStorage.getItem(getCacheKey('me'))!)
    const found = cached.good.find((s: { id: string }) => s.id === id)
    expect(found.adopted).toBe(true)
  })
})
