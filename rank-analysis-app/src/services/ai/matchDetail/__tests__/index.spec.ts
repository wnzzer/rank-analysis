import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../stream', () => ({
  requestAIContent: vi.fn(),
  requestAIContentStream: vi.fn(),
  DEFAULT_SYSTEM_PROMPT: 'sys'
}))

import { requestAIContent, requestAIContentStream } from '../../stream'
import { analyzeMatchDetail } from '../index'
import type { Game } from '@renderer/types/domain/match'

const mockRequest = requestAIContent as ReturnType<typeof vi.fn>
const mockStream = requestAIContentStream as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockRequest.mockReset()
  mockStream.mockReset()
  sessionStorage.clear()
})

function makeGame(): Game {
  return {
    gameId: 12345,
    queueId: 420,
    queueName: '排位',
    gameMode: 'CLASSIC',
    gameDuration: 1800,
    participants: [
      {
        participantId: 1,
        teamId: 100,
        championId: 64,
        spell1Id: 4,
        spell2Id: 11,
        teamPosition: 'JUNGLE',
        stats: {
          win: true,
          kills: 8,
          deaths: 3,
          assists: 12,
          totalDamageDealtToChampions: 28000,
          totalDamageTaken: 18000,
          goldEarned: 13000,
          totalMinionsKilled: 100,
          neutralMinionsKilled: 80,
          totalHeal: 1000,
          damageDealtToTurrets: 3000,
          perk0: 8005,
          perkSubStyle: 8200,
          playerAugment1: 0,
          playerAugment2: 0,
          playerAugment3: 0,
          playerAugment4: 0,
          playerAugment5: 0,
          playerAugment6: 0,
          item0: 1001,
          item1: 1018,
          item2: 1031,
          item3: 1037,
          item4: 1042,
          item5: 0,
          item6: 3340,
          doubleKills: 0,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          visionScore: 25,
          sightWardsBoughtInGame: 0,
          visionWardsBoughtInGame: 2
        },
        timeline: { lane: 'JUNGLE', role: 'NONE' }
      },
      ...[2, 3, 4].map(id => ({
        participantId: id,
        teamId: id === 2 ? 100 : 200,
        championId: 1,
        spell1Id: 4,
        spell2Id: 7,
        teamPosition: 'MIDDLE',
        stats: {
          win: id === 2,
          kills: 3,
          deaths: 5,
          assists: 4,
          totalDamageDealtToChampions: 18000,
          totalDamageTaken: 16000,
          goldEarned: 10000,
          totalMinionsKilled: 150,
          neutralMinionsKilled: 10,
          totalHeal: 500,
          damageDealtToTurrets: 1500,
          perk0: 8200,
          perkSubStyle: 8000,
          playerAugment1: 0,
          playerAugment2: 0,
          playerAugment3: 0,
          playerAugment4: 0,
          playerAugment5: 0,
          playerAugment6: 0,
          item0: 0,
          item1: 0,
          item2: 0,
          item3: 0,
          item4: 0,
          item5: 0,
          item6: 0,
          doubleKills: 0,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          visionScore: 10,
          sightWardsBoughtInGame: 0,
          visionWardsBoughtInGame: 1
        },
        timeline: { lane: 'MIDDLE', role: 'NONE' }
      }))
    ],
    participantIdentities: [1, 2, 3, 4].map(id => ({
      participantId: id,
      player: { gameName: `P${id}`, tagLine: '0000', puuid: `puuid_${id}` }
    }))
  } as any
}

function fakeAttributionJson() {
  return JSON.stringify({
    winReason: '蓝方运营碾压',
    verdicts: [1, 2, 3, 4].map(id => ({
      participantId: id,
      name: `P${id}#0000`,
      label: id === 1 ? '尽力' : '正常',
      evidenceMetrics: [
        { metric: 'kda', value: 2 },
        { metric: 'damageShare', value: 20 },
        { metric: 'killParticipation', value: 50 }
      ],
      mitigatingFactors: [],
      finalCall: '数据中位'
    }))
  })
}

/** Stage 2 合法草案（JSON mode 产物的最小可解析形态） */
function fakeDraftJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    verdict: 'win',
    oneLiner: '蓝方碾压。',
    comments: {
      '1': '打野节奏拉满，C 王',
      '2': '中路数据中位',
      '3': '补位尽力',
      '4': '挂件'
    },
    evidence: ['蓝方运营优势滚雪球'],
    ...overrides
  })
}

describe('analyzeMatchDetail', () => {
  it('completes both stages and returns ok with structured report', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('{"verdict":"win","oneLiner":"蓝方碾压')
      callbacks.onChunk('。","comments":{"1":"打野节奏拉满，C 王"},"evidence":[]}')
      callbacks.onDone()
    })

    const chunks: string[] = []
    const out = await analyzeMatchDetail(makeGame(), null, {
      onChunk: c => chunks.push(c),
      onDone: () => {},
      onError: () => {}
    })

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.attribution.verdicts.length).toBe(4)
      expect(out.report.oneLiner).toContain('蓝方碾压')
      expect(out.report.verdict).toBe('win')
      // 名册分组确定性来自 Stage 1 label：participant 1 为「尽力」
      expect(out.report.mvps).toHaveLength(1)
      expect(out.report.mvps[0].participantId).toBe(1)
      expect(out.report.mvps[0].reason).toBe('打野节奏拉满，C 王')
      expect(out.report.sunkCosts).toHaveLength(0)
    }
    expect(chunks.join('')).toContain('蓝方碾压')
  })

  it('returns stage1Error when AI Stage 1 fails', async () => {
    mockRequest.mockResolvedValue({ success: false, error: 'network' })

    const out = await analyzeMatchDetail(makeGame(), null, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {}
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.stage).toBe('attribution')
    }
  })

  it('retries Stage 1 once on parse failure', async () => {
    mockRequest
      .mockResolvedValueOnce({ success: true, content: 'bad json' })
      .mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk(fakeDraftJson())
      callbacks.onDone()
    })

    const out = await analyzeMatchDetail(makeGame(), null, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {}
    })
    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(out.ok).toBe(true)
  })

  it('falls back to template markdown when Stage 2 fails', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onError('stream down')
    })

    const out = await analyzeMatchDetail(makeGame(), null, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {}
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.stage).toBe('critique')
      expect(out.fallbackMarkdown).toContain('## 一句话定论')
    }
  })

  it('falls back when Stage 2 parses non-JSON output', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, content: fakeAttributionJson() })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('## 一句话定论\n模型摆烂输出 markdown。\n')
      callbacks.onDone()
    })

    const out = await analyzeMatchDetail(makeGame(), null, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {}
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.stage).toBe('critique')
      expect(out.fallbackMarkdown).toContain('## 一句话定论')
    }
  })

  it('uses sessionStorage cache for Stage 1', async () => {
    const cached = JSON.stringify({
      winReason: 'cached',
      verdicts: [1, 2, 3, 4].map(id => ({
        participantId: id,
        name: `P${id}#0000`,
        label: '正常',
        evidenceMetrics: [
          { metric: 'kda', value: 2 },
          { metric: 'damageShare', value: 20 },
          { metric: 'killParticipation', value: 50 }
        ],
        mitigatingFactors: [],
        finalCall: 'x'
      }))
    })
    // Stage 1 缓存键与 requestAIContent 的键统一（含模型后缀）
    sessionStorage.setItem('ai_match_detail_stage1_12345_ranked_qwen-flash', cached)
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk(fakeDraftJson({ oneLiner: 'cached run' }))
      callbacks.onDone()
    })

    const out = await analyzeMatchDetail(makeGame(), null, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {}
    })
    expect(mockRequest).toHaveBeenCalledTimes(0)
    expect(out.ok).toBe(true)
  })

  it('short-circuits when Stage 1 + Stage 2 缓存双命中（不调任何 AI）', async () => {
    sessionStorage.setItem('ai_match_detail_stage1_12345_ranked_qwen-flash', fakeAttributionJson())
    sessionStorage.setItem(
      'ai_match_detail_stage2_12345_ranked',
      fakeDraftJson({ oneLiner: '缓存锐评' })
    )

    const out = await analyzeMatchDetail(makeGame(), null, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {}
    })
    expect(mockRequest).toHaveBeenCalledTimes(0)
    expect(mockStream).toHaveBeenCalledTimes(0)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.report.oneLiner).toBe('缓存锐评')
      expect(out.report.mvps[0].reason).toBe('打野节奏拉满，C 王')
    }
  })

  it('player 模式走单人复盘 prompt 且缓存 key 按 participantId 区分', async () => {
    mockRequest.mockResolvedValue({ success: true, content: fakeAttributionJson() })
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk(
        fakeDraftJson({ oneLiner: '单人内容。', rating: 8, metrics: ['KDA 3.0 全场第一'] })
      )
      callbacks.onDone()
    })

    const out = await analyzeMatchDetail(
      makeGame(),
      null,
      { onChunk: () => {}, onDone: () => {}, onError: () => {} },
      { mode: 'player', participantId: 1 }
    )
    expect(out.ok).toBe(true)
    // 单人 prompt：包含目标玩家区块
    const prompt = mockStream.mock.calls[0][0] as string
    expect(prompt).toContain('【目标玩家】')
    expect(prompt).toContain('P1#0000')
    // 单人扩展字段被装配进报告
    if (out.ok) {
      expect(out.report.ownScore?.rating).toBe(8)
      expect(out.report.ownScore?.metrics).toContain('KDA 3.0 全场第一')
    }
    // 缓存 key 带 participantId，不与整局互串
    expect(sessionStorage.getItem('ai_match_detail_stage2_12345_ranked_p1')).toContain('单人内容')
    expect(sessionStorage.getItem('ai_match_detail_stage2_12345_ranked')).toBeNull()
  })

  it('整局缓存命中不影响 player 模式（缓存不互串回归）', async () => {
    sessionStorage.setItem('ai_match_detail_stage2_12345_ranked', '整局缓存内容')
    sessionStorage.setItem('ai_match_detail_stage1_12345_ranked_qwen-flash', fakeAttributionJson())
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk(fakeDraftJson({ oneLiner: '单人新内容' }))
      callbacks.onDone()
    })

    const chunks: string[] = []
    const out = await analyzeMatchDetail(
      makeGame(),
      null,
      { onChunk: c => chunks.push(c), onDone: () => {}, onError: () => {} },
      { mode: 'player', participantId: 2 }
    )
    expect(out.ok).toBe(true)
    expect(chunks.join('')).toContain('单人新内容')
    expect(chunks.join('')).not.toContain('整局缓存内容')
  })
})
