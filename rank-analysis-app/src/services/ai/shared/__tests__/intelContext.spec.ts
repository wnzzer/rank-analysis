/**
 * 情报块构建器测试：版本情报/克制/信号/模式知识聚合与降级。
 * @module services/ai/shared/intelContext
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@renderer/services/opgg', () => ({
  getChampionMeta: vi.fn(),
  getLaneCounters: vi.fn()
}))
vi.mock('@renderer/services/knowledge', () => ({
  getKnowledgeBase: vi.fn()
}))

import { getChampionMeta, getLaneCounters } from '@renderer/services/opgg'
import { getKnowledgeBase } from '@renderer/services/knowledge'
import type { KnowledgeBase } from '@renderer/services/knowledge'
import type { RecentPlayerProfile } from '../types'
import {
  buildIntelContext,
  intelBlockExists,
  intelBlockToText,
  modeKnowledgeKey
} from '../intelContext'

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    mySubteamId: 1,
    subteams: [
      {
        subteamId: 1,
        players: [
          { summoner: { puuid: 'me', gameName: 'Self' }, assignedPosition: 'TOP', championId: 157 },
          {
            summoner: { puuid: 'mate', gameName: 'Buddy' },
            assignedPosition: 'JUNGLE',
            championId: 104
          }
        ]
      },
      {
        subteamId: 2,
        players: [
          {
            summoner: { puuid: 'foe', gameName: 'Foe' },
            assignedPosition: 'BOTTOM',
            championId: 222
          }
        ]
      }
    ],
    ...overrides
  }
}

function knowledgeBase(overrides: Record<string, unknown> = {}): KnowledgeBase {
  return {
    schemaVersion: 1,
    patch: '26.13',
    updatedAt: '2026-08-16T00:00:00Z',
    patchNotes: {},
    championNotes: {},
    modeKnowledge: {
      ranked: ['[对局节奏] 前 15 分钟线权决定小龙团主动权', '[心态与沟通] 连败超 3 场容易上头'],
      aram: [],
      brawl: []
    },
    signalRules: [
      {
        id: 'loser-streak',
        scope: 'teammate',
        position: undefined,
        whenAll: [{ metric: 'lossStreak', op: 'gte', value: 4 }],
        whenAny: [],
        text: '{name}正在{lossStreak}连败，注意心态与对线保守',
        severity: 'warn'
      }
    ],
    ...overrides
  }
}

describe('modeKnowledgeKey', () => {
  it('ranked / aram / 斗魂(1700)→brawl / 海克斯大乱斗(2400)→mayhem 正确映射', () => {
    expect(modeKnowledgeKey('ranked', 420)).toBe('ranked')
    expect(modeKnowledgeKey('aram', 450)).toBe('aram')
    expect(modeKnowledgeKey('augment', 1700)).toBe('brawl')
    expect(modeKnowledgeKey('augment', 2400)).toBe('mayhem')
    expect(modeKnowledgeKey('unknown', 0)).toBeNull()
  })
})

describe('buildIntelContext', () => {
  beforeEach(() => {
    vi.mocked(getChampionMeta).mockReset()
    vi.mocked(getLaneCounters).mockReset()
    vi.mocked(getKnowledgeBase).mockReset()
  })

  it('版本情报：本局 10 英雄去重拉 meta，header 带知识库 patch', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(knowledgeBase())
    vi.mocked(getChampionMeta).mockImplementation(async () => ({
      championId: 157,
      position: 'TOP',
      tier: 1,
      rank: 1,
      rankPrevPatch: 2,
      winRate: 0.523,
      pickRate: 0.3,
      banRate: 0.1,
      roleRate: 0.9,
      isMainPosition: true
    }))

    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map(),
      opggMode: 'ranked',
      modeKind: 'ranked',
      queueId: 420
    })

    expect(ctx.header).toContain('26.13')
    expect(ctx.header).toContain('OP.GG(外服)')
    expect(ctx.championLines).toHaveLength(3)
    expect(ctx.championLines[0]).toContain('T1，胜率52.3%')
  })

  it('克制块：我方英雄对敌方英雄的对位胜率（ranked only）', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(knowledgeBase())
    vi.mocked(getChampionMeta).mockResolvedValue(null)
    vi.mocked(getLaneCounters).mockResolvedValue({
      157: [{ opponentId: 222, position: 'TOP', subjectWinRate: 0.46, play: 12000 }]
    })

    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map(),
      opggMode: 'ranked',
      modeKind: 'ranked',
      queueId: 420
    })

    expect(ctx.counterLines).toHaveLength(1)
    expect(ctx.counterLines[0]).toContain('对线胜率46%')
    expect(ctx.counterLines[0]).toContain('仅供参考')
  })

  it('关联信号：连败队友产出信号行', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(knowledgeBase())
    vi.mocked(getChampionMeta).mockResolvedValue(null)
    const profile: RecentPlayerProfile = {
      positionDistribution: [{ pos: 'JUNGLE', ratio: 1, games: 10 }],
      mainPosition: 'JUNGLE',
      currentLanePlayedRatio: 1,
      championDistribution: [],
      positionChampionDistribution: [],
      currentChampionMastery: null,
      recentWinRate: 0.2,
      recentKda: 1.1,
      streak: { kind: 'loss', count: 5 },
      isOffRole: false,
      offRoleSeverity: 'none'
    }
    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map([['mate', profile]]),
      opggMode: undefined,
      modeKind: 'ranked',
      queueId: 420
    })

    expect(ctx.signalLines).toHaveLength(1)
    expect(ctx.signalLines[0]).toContain('[warn] Buddy正在5连败')
  })

  it('模式知识：ranked 映射取前 4 条', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(knowledgeBase())
    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map(),
      modeKind: 'aram',
      queueId: 450
    })
    expect(ctx.modeKnowledgeLines).toEqual([])
  })

  it('玩家画像明细：有画像的玩家每人一行（近胜率/主玩/英雄池/备注）', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(knowledgeBase())
    const profile: RecentPlayerProfile = {
      positionDistribution: [{ pos: 'JUNGLE', ratio: 0.8, games: 8 }],
      mainPosition: 'JUNGLE',
      currentLanePlayedRatio: 0.8,
      championDistribution: [],
      positionChampionDistribution: [
        { championId: 64, name: '李青', games: 6, winRate: 0.66, avgKda: 3.1 }
      ],
      currentChampionMastery: {
        gamesInRecent: 6,
        winRate: 0.66,
        avgKda: 3.1,
        isOnetrick: true,
        isFirstTimeInRecent: false
      },
      recentWinRate: 0.55,
      recentKda: 2.2,
      streak: null,
      isOffRole: false,
      offRoleSeverity: 'none',
      note: '[红牌] 爱哭'
    }
    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map([['mate', profile]]),
      opggMode: undefined,
      modeKind: 'ranked',
      queueId: 420
    })
    expect(ctx.profileLines).toHaveLength(1)
    const line = ctx.profileLines[0]
    expect(line).toContain('Buddy')
    expect(line).toContain('55%胜率')
    expect(line).toContain('主玩打野')
    expect(line).toContain('李青6场66%')
    expect(line).toContain('绝活')
    expect(line).toContain('备注【[红牌] 爱哭】')
  })

  it('玩家画像明细：无画像的玩家不出行；intelBlockToText 含【玩家画像】头', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(knowledgeBase())
    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map(),
      opggMode: undefined,
      modeKind: 'ranked',
      queueId: 420
    })
    expect(ctx.profileLines).toEqual([])
    const text = intelBlockToText({ ...ctx, profileLines: ['- 某人: 60%胜率'] })
    expect(text).toContain('【玩家画像】')
    expect(intelBlockExists({ ...ctx, profileLines: ['- 某人'] })).toBe(true)
  })

  it('knowledge 为空：整块降级为空（不抛异常）', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(null)
    vi.mocked(getChampionMeta).mockResolvedValue(null)
    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map(),
      opggMode: 'ranked',
      modeKind: 'ranked',
      queueId: 420
    })
    expect(intelBlockExists(ctx)).toBe(false)
    expect(intelBlockToText(ctx)).toBe('')
  })

  it('无 opggMode（斗魂）：版本情报与克制整体省略', async () => {
    vi.mocked(getKnowledgeBase).mockResolvedValue(knowledgeBase())
    const ctx = await buildIntelContext({
      sessionData: sessionData(),
      profileMap: new Map(),
      modeKind: 'augment',
      queueId: 2400
    })
    expect(ctx.header).toBe('')
    expect(ctx.championLines).toEqual([])
    expect(ctx.counterLines).toEqual([])
    expect(ctx.modeKnowledgeLines).toEqual([])
  })
})

describe('intelBlockToText', () => {
  it('拼接顺序：版本情报 → 克制 → 信号 → 画像 → 模式知识', () => {
    const text = intelBlockToText({
      header: '【版本情报 · 26.13 · 数据来源OP.GG(外服)】',
      championLines: ['- A'],
      counterLines: ['- B'],
      signalLines: ['- [warn] C'],
      profileLines: [],
      modeKnowledgeLines: ['- D']
    })
    const lines = text.split('\n')
    expect(lines[0]).toContain('版本情报')
    expect(lines[1]).toBe('- A')
    expect(lines[2]).toBe('【对线克制】')
    expect(lines[3]).toBe('- B')
    expect(
      lines.includes('【关联信号】（程序基于近期战绩计算的事实，请直接解读，不要重新计算）')
    ).toBe(true)
    expect(text).toContain('- D')
  })
})
