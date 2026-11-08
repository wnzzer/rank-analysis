import { describe, it, expect, beforeEach, vi } from 'vitest'

// 模型远程配置走 IPC，单测里直接用内置默认模型
vi.mock('../../modelConfig', () => ({
  resolveModel: vi.fn(async (_scene: string, fallback: string) => fallback)
}))
vi.mock('../../stream', () => ({
  requestAIContent: vi.fn(),
  requestAIContentStream: vi.fn(),
  DEFAULT_SYSTEM_PROMPT: 'sys'
}))

// 时间线卡片由测试直接给定（真实提取器另有单测）；其余导出保持原实现
const fakeCards = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock('../../shared/timeline', async importOriginal => ({
  ...(await importOriginal<typeof import('../../shared/timeline')>()),
  buildTimelineCards: () => fakeCards.value
}))

import { resolveModel } from '../../modelConfig'
import { requestAIContent, requestAIContentStream } from '../../stream'
import type { SlimTimeline, TimelineCard } from '../../shared/timeline'
import { STAGE2_MODEL } from '../critique'
import { analyzeMatchDetail } from '../index'
import { readStage2Cache, writeStage2Cache } from '../stage2Cache'
import type { MisattributionMaterial } from '../misattribution'
import type { Game } from '@renderer/types/domain/match'

const mockRequest = requestAIContent as ReturnType<typeof vi.fn>
const mockStream = requestAIContentStream as ReturnType<typeof vi.fn>
const mockResolveModel = resolveModel as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockRequest.mockReset()
  mockStream.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  fakeCards.value = []
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

const cbs = { onChunk: () => {}, onDone: () => {}, onError: () => {} }
const streamOk = (text: string) =>
  mockStream.mockImplementation(async (_p, callbacks) => {
    callbacks.onChunk(text)
    callbacks.onDone()
  })

describe('analyzeMatchDetail（单次模型调用）', () => {
  it('重开局(时长<5分钟)不打模型,直接返回固定说明', async () => {
    const g = { ...makeGame(), gameDuration: 90 }
    const chunks: string[] = []
    const out = await analyzeMatchDetail(g, null, { ...cbs, onChunk: c => chunks.push(c) })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.attribution.verdicts).toEqual([])
    expect(chunks.join('')).toContain('重开')
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('只调用一次流式模型；归因骨架由 TS 生成并先于开流回调', async () => {
    streamOk('## 一句话定论\n蓝方碾压。\n')
    const order: string[] = []
    mockStream.mockImplementationOnce(async (_p, callbacks) => {
      order.push('stream')
      callbacks.onChunk('## 一句话定论\n蓝方碾压。\n')
      callbacks.onDone()
    })
    const out = await analyzeMatchDetail(makeGame(), null, cbs, {
      onAttribution: () => order.push('attribution')
    })
    expect(out.ok).toBe(true)
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['attribution', 'stream'])
    if (out.ok) {
      expect(out.attribution.verdicts.length).toBe(4)
      expect(Object.keys(out.attribution.scores ?? {})).toHaveLength(4)
      expect(out.markdown).toContain('蓝方碾压')
    }
    expect(mockStream.mock.calls[0][0]).toContain('【表现评估】')
  })

  it('Stage 2 失败 → critique 阶段错误 + 模板兜底', async () => {
    mockStream.mockImplementation(async (_p, callbacks) => callbacks.onError('boom'))
    const out = await analyzeMatchDetail(makeGame(), null, cbs)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.stage).toBe('critique')
      expect(out.fallbackMarkdown).toContain('## 一句话定论')
      expect(out.attribution?.verdicts.length).toBe(4)
    }
  })

  it('Stage 2 markdown 缓存命中时不再调模型；两次归因完全相同（确定性）', async () => {
    streamOk('首轮内容')
    const a = await analyzeMatchDetail(makeGame(), null, cbs)
    const b = await analyzeMatchDetail(makeGame(), null, cbs)
    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(b.markdown).toBe('首轮内容')
      expect(b.attribution).toEqual(a.attribution)
    }
  })

  it('缓存跨窗口持久：另一个窗口写入的整局点评命中，不再计费', async () => {
    // 模拟上一个详情窗口生成过：同一 localStorage，sessionStorage 已是新窗口的空表
    writeStage2Cache(`ai_match_detail_stage2_12345_ranked_${STAGE2_MODEL}`, '上个窗口的点评')
    sessionStorage.clear()
    const out = await analyzeMatchDetail(makeGame(), null, cbs)
    expect(mockStream).not.toHaveBeenCalled()
    expect(out.ok && out.markdown).toBe('上个窗口的点评')
  })

  it('有时间线的缓存 key 带 _tl 后缀，与无时间线互不串用', async () => {
    // 至少一张卡片快照才带 timeline（无卡片等同无时间线）
    fakeCards.value = [
      { id: 'D1', kind: 'death', subjects: [1, 2], minute: 5, text: 'D1', numbers: [5], weight: 1 }
    ]
    streamOk('带时间线内容')
    const tl = {
      gameId: 12345,
      participants: [],
      frames: [],
      events: []
    } as unknown as SlimTimeline
    await analyzeMatchDetail(makeGame(), null, cbs, { timeline: tl })
    expect(readStage2Cache(`ai_match_detail_stage2_12345_ranked_tl_${STAGE2_MODEL}`)).toBe(
      '带时间线内容'
    )
    expect(readStage2Cache(`ai_match_detail_stage2_12345_ranked_${STAGE2_MODEL}`)).toBeNull()
  })

  it('player 模式走单人复盘 prompt 且缓存 key 按 participantId 区分', async () => {
    streamOk('## 一句话定档\n单人内容。\n')
    const out = await analyzeMatchDetail(makeGame(), null, cbs, {
      mode: 'player',
      participantId: 1
    })
    expect(out.ok).toBe(true)
    const prompt = mockStream.mock.calls[0][0] as string
    expect(prompt).toContain('【目标玩家】')
    expect(prompt).toContain('P1#0000')
    expect(readStage2Cache(`ai_match_detail_stage2_12345_ranked_p1_${STAGE2_MODEL}`)).toContain(
      '单人内容'
    )
    expect(readStage2Cache(`ai_match_detail_stage2_12345_ranked_${STAGE2_MODEL}`)).toBeNull()
  })

  it('整局缓存命中不影响 player 模式（缓存不互串回归）', async () => {
    writeStage2Cache(`ai_match_detail_stage2_12345_ranked_${STAGE2_MODEL}`, '整局缓存内容')
    streamOk('单人新内容')
    const chunks: string[] = []
    await analyzeMatchDetail(
      makeGame(),
      null,
      { ...cbs, onChunk: c => chunks.push(c) },
      { mode: 'player', participantId: 2 }
    )
    expect(chunks.join('')).toContain('单人新内容')
    expect(chunks.join('')).not.toContain('整局缓存内容')
  })
})

describe('overview Stage 2 缓存命中', () => {
  it('onAttribution 仍触发（带 name+label 名册）且先于 onChunk', async () => {
    writeStage2Cache(`ai_match_detail_stage2_12345_ranked_${STAGE2_MODEL}`, '缓存内容')
    const order: string[] = []
    let roster: Array<{ name: string; label: string }> = []
    const out = await analyzeMatchDetail(
      makeGame(),
      null,
      { ...cbs, onChunk: () => order.push('chunk') },
      {
        onAttribution: a => {
          order.push('attribution')
          roster = a.verdicts.map(v => ({ name: v.name, label: v.label }))
        }
      }
    )
    expect(out.ok).toBe(true)
    expect(mockStream).not.toHaveBeenCalled()
    expect(order).toEqual(['attribution', 'chunk'])
    expect(roster.length).toBeGreaterThan(0)
    for (const r of roster) {
      expect(r.name).toBeTruthy()
      expect(r.label).toBeTruthy()
    }
  })
})

describe('onStage2Material(单人复盘材料数字白名单)', () => {
  it('player 模式实时路径:回调收到 prompt 中的数字集合', async () => {
    streamOk('## 一句话定档\n内容。\n')
    let got: Set<number> | null = null
    await analyzeMatchDetail(makeGame(), null, cbs, {
      mode: 'player',
      participantId: 1,
      onStage2Material: n => (got = n)
    })
    expect(got!.size).toBeGreaterThan(0)
  })

  it('player 模式缓存命中:白名单从重建的 prompt 补发', async () => {
    writeStage2Cache(
      `ai_match_detail_stage2_12345_ranked_p1_${STAGE2_MODEL}`,
      '## 一句话定档\n缓存内容'
    )
    let got: Set<number> | null = null
    const out = await analyzeMatchDetail(makeGame(), null, cbs, {
      mode: 'player',
      participantId: 1,
      onStage2Material: n => (got = n)
    })
    expect(out.ok).toBe(true)
    expect(mockStream).toHaveBeenCalledTimes(0)
    expect(got!.size).toBeGreaterThan(0)
  })

  it('overview 模式同样回调白名单(整局锐评也会编数字,真机 301041798766)', async () => {
    streamOk('## 一句话定论\n内容。\n')
    let got: Set<number> | null = null
    await analyzeMatchDetail(makeGame(), null, cbs, { onStage2Material: n => (got = n) })
    expect(got!.size).toBeGreaterThan(0)
  })
})

describe('onEntityFacts(张冠李戴过滤材料)', () => {
  it('overview:回调全部玩家且无 subjectId', async () => {
    streamOk('## 一句话定论\n内容。\n')
    let got: MisattributionMaterial | null = null
    await analyzeMatchDetail(makeGame(), null, cbs, { onEntityFacts: m => (got = m) })
    expect(got!.players.map(p => p.participantId)).toEqual([1, 2, 3, 4])
    expect(got!.subjectId).toBeUndefined()
  })

  it('player:subjectId 为目标玩家；缓存命中同样回调', async () => {
    writeStage2Cache(`ai_match_detail_stage2_12345_ranked_p2_${STAGE2_MODEL}`, '缓存内容')
    let got: MisattributionMaterial | null = null
    await analyzeMatchDetail(makeGame(), null, cbs, {
      mode: 'player',
      participantId: 2,
      onEntityFacts: m => (got = m)
    })
    expect(mockStream).not.toHaveBeenCalled()
    expect(got!.subjectId).toBe(2)
  })
})

describe('Stage 2 模型远程可配', () => {
  it('用 resolveModel 给出的模型请求，且缓存键带模型名（换模型不串旧文本）', async () => {
    writeStage2Cache(`ai_match_detail_stage2_12345_ranked_${STAGE2_MODEL}`, '旧模型的点评')
    mockResolveModel.mockResolvedValueOnce('qwen-plus')
    streamOk('新模型内容')
    const out = await analyzeMatchDetail(makeGame(), null, cbs)
    expect(mockResolveModel).toHaveBeenCalledWith('matchCritique', STAGE2_MODEL)
    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockStream.mock.calls[0][3]).toBe('qwen-plus')
    expect(out.ok && out.markdown).toBe('新模型内容')
    expect(readStage2Cache('ai_match_detail_stage2_12345_ranked_qwen-plus')).toBe('新模型内容')
  })
})

describe('onTimelineCards(只回传模型实际看到的卡片)', () => {
  const death = (id: string, minute: number): TimelineCard => ({
    id,
    kind: 'death',
    subjects: [1, 2],
    minute,
    text: `${id} 原文`,
    numbers: [minute],
    weight: 1
  })
  // 玩家 1 三张同权重死亡卡：整局 prompt 只展示前 1 张，D2/D3 仅单人 prompt 可见
  const all = [death('D1', 5), death('D2', 9), death('D3', 12)]
  const tl = { gameId: 12345, participants: [], frames: [], events: [] } as unknown as SlimTimeline

  beforeEach(() => {
    fakeCards.value = all
    mockStream.mockImplementation(async (_p, callbacks) => {
      callbacks.onChunk('## 一句话定论\n内容。\n')
      callbacks.onDone()
    })
  })

  const run = async (opts: { mode?: 'overview' | 'player'; participantId?: number }) => {
    let got: TimelineCard[] | null | undefined
    await analyzeMatchDetail(
      makeGame(),
      null,
      { onChunk: () => {}, onDone: () => {}, onError: () => {} },
      { ...opts, timeline: tl, onTimelineCards: c => (got = c) }
    )
    return got?.map(c => c.id)
  }

  it('overview: only the Stage 1/Stage 2 overview selection', async () => {
    expect(await run({})).toEqual(['D1'])
  })

  it('player: that player selection (plus winReason-cited cards)', async () => {
    expect(await run({ mode: 'player', participantId: 1 })).toEqual(['D1', 'D2', 'D3'])
  })
})
