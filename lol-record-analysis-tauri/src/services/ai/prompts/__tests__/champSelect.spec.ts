import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildChampSelectPrompt } from '../champSelect'
import { findCounterHints } from '@renderer/services/opgg'
import type { SessionData, SessionSummoner } from '@renderer/types/domain/gaming'

const CHAMP_NAMES: Record<number, string> = {
  103: '阿狸',
  238: '劫',
  64: '李青',
  55: '卡特琳娜',
  266: '剑魔'
}

vi.mock('../../champion-names', () => ({
  getChampionName: vi.fn((id: number) => CHAMP_NAMES[id] || `英雄${id}`),
  loadChampionNames: vi.fn(async () => {})
}))

vi.mock('@renderer/services/opgg', () => ({
  getChampionMeta: vi.fn(async (_mode: string, championId: number) =>
    championId === 238
      ? {
          championId: 238,
          position: 'mid',
          tier: 1,
          rank: 1,
          winRate: 0.532,
          pickRate: 0.1,
          banRate: 0.05,
          roleRate: 0.9,
          isMainPosition: true
        }
      : null
  ),
  getLaneCounters: vi.fn(async () => ({})),
  findCounterHints: vi.fn(() => [])
}))

/** 构造我方玩家（puuid/战绩齐全） */
function makeMyPlayer(opts: {
  name: string
  puuid: string
  championId: number
  pickState: string
  tierCn: string
}): SessionSummoner {
  return {
    championId: opts.championId,
    championKey: '',
    summoner: {
      puuid: opts.puuid,
      gameName: opts.name,
      tagLine: 'CN1',
      summonerLevel: 100,
      profileIconId: 1
    },
    matchHistory: { games: { games: [] } },
    userTag: { tag: [], recentData: { selectWins: 6, selectLosses: 4, kda: 3.2 } },
    rank: { queueMap: { RANKED_SOLO_5x5: { tierCn: opts.tierCn } } },
    meetGames: [],
    preGroupMarkers: { name: '', type: '' },
    pickState: opts.pickState
  } as unknown as SessionSummoner
}

/** 构造敌方玩家（puuid 空，只有 championId + pickState） */
function makeEnemyPlayer(championId: number, pickState: string): SessionSummoner {
  return {
    championId,
    championKey: '',
    summoner: { puuid: '', gameName: '', tagLine: '', summonerLevel: 0, profileIconId: 0 },
    matchHistory: { games: { games: [] } },
    userTag: { tag: [] },
    rank: {},
    meetGames: [],
    preGroupMarkers: { name: '', type: '' },
    pickState
  } as unknown as SessionSummoner
}

function makeSessionData(opts: {
  enemyPlayers?: SessionSummoner[]
  noEnemySubteam?: boolean
}): SessionData {
  const subteams = [
    {
      subteamId: 1,
      players: [
        makeMyPlayer({
          name: '我方甲',
          puuid: 'p1',
          championId: 103,
          pickState: 'locked',
          tierCn: '钻石IV'
        }),
        makeMyPlayer({
          name: '我方乙',
          puuid: 'p2',
          championId: 0,
          pickState: 'none',
          tierCn: '铂金II'
        })
      ]
    }
  ]
  if (!opts.noEnemySubteam) {
    subteams.push({
      subteamId: 2,
      players: opts.enemyPlayers ?? [makeEnemyPlayer(238, 'locked'), makeEnemyPlayer(0, 'none')]
    })
  }

  return {
    phase: 'ChampSelect',
    type: 'RANKED_SOLO_5x5',
    typeCn: '单双排位',
    queueId: 420,
    gameMode: 'CLASSIC',
    isMultiTeam: false,
    mySubteamId: 1,
    subteams,
    champSelect: {
      stage: 'picking',
      myBans: [64],
      theirBans: [55]
    }
  }
}

describe('buildChampSelectPrompt', () => {
  beforeEach(() => {
    // 清掉上一个用例遗留的 mockReturnValueOnce 队列，回到默认"无克制提示"
    vi.mocked(findCounterHints).mockReset()
    vi.mocked(findCounterHints).mockReturnValue([])
  })

  it('includes 模式/我方玩家名与段位', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('单双排位')
    expect(prompt).toContain('我方甲')
    expect(prompt).toContain('钻石IV')
    expect(prompt).toContain('我方乙')
    expect(prompt).toContain('铂金II')
  })

  it('includes 敌方英雄名与 T 级', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('劫')
    expect(prompt).toContain('T1')
  })

  it('includes ban 名字', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('李青') // 我方 ban
    expect(prompt).toContain('卡特琳娜') // 敌方 ban
  })

  it('includes 「未亮出」计数', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('其余 1 人未亮出')
  })

  it('includes 分析纪律关键词"禁止编造"', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('禁止编造')
  })

  it('marks 未锁定 champion picks', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    // 我方乙 championId=0 → 显示"未选"，不应出现"未锁定"误标
    expect(prompt).toContain('未选')
  })

  it('annotates （未锁定） when my player has champion but pickState !== locked', async () => {
    const session = makeSessionData({})
    // 我方乙改为已选英雄但仍在 picking → 名字后要带"（未锁定）"标注
    session.subteams[0].players[1] = makeMyPlayer({
      name: '我方乙',
      puuid: 'p2',
      championId: 55,
      pickState: 'picking',
      tierCn: '铂金II'
    })
    const prompt = await buildChampSelectPrompt(session, 'ranked')
    expect(prompt).toContain('卡特琳娜（未锁定）')
  })

  it('renders 「怕我方」 counter hint with percent when enemy fears my champion', async () => {
    vi.mocked(findCounterHints).mockReturnValueOnce([{ myChampionId: 266, myWinRate: 0.56 }])
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('怕我方剑魔（56%）')
  })

  it('renders 「克制我方」 counter hint with percent when enemy counters my champion', async () => {
    vi.mocked(findCounterHints).mockReturnValueOnce([{ myChampionId: 266, myWinRate: 0.44 }])
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('克制我方剑魔（56%）')
  })

  it('shows "敌方不可见" when enemy subteam is entirely absent (随机英雄模式)', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({ noEnemySubteam: true }), 'aram')
    expect(prompt).toContain('敌方不可见')
  })
})
