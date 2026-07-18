import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildChampSelectPrompt } from '../champSelect'
import { findCounterHints } from '@renderer/services/opgg'
import { getChampionPatchNote } from '@renderer/services/patchNotes'
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

vi.mock('@renderer/services/patchNotes', () => ({
  getChampionPatchNote: vi.fn(async () => null)
}))

vi.mock('@renderer/services/opgg', () => ({
  getChampionMeta: vi.fn(async (_mode: string, championId: number) =>
    championId === 238
      ? {
          championId: 238,
          position: 'JUNGLE',
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
  assignedPosition?: string
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
    pickState: opts.pickState,
    assignedPosition: opts.assignedPosition
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
    // 版本改动默认全 null（无改动），需要改动数据的用例自行覆盖
    vi.mocked(getChampionPatchNote).mockReset()
    vi.mocked(getChampionPatchNote).mockResolvedValue(null)
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

  it('includes 敌方主分路（中文，来自 OP.GG position）', async () => {
    // mock 里 championId 238（劫）的 meta.position 为 'JUNGLE'
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('主分路打野')
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

  it('禁止选人类建议 when 我方全部锁定 (allMyLocked)', async () => {
    const session = makeSessionData({})
    // 我方乙从 championId=0/none 改为已选且已锁定 → 我方两人均 locked，触发 allMyLocked
    session.subteams[0].players[1] = makeMyPlayer({
      name: '我方乙',
      puuid: 'p2',
      championId: 55,
      pickState: 'locked',
      tierCn: '铂金II'
    })
    const prompt = await buildChampSelectPrompt(session, 'ranked')
    expect(prompt).toContain('禁止给出任何选英雄')
  })

  it('允许选人类建议 when 我方尚未全部锁定', async () => {
    // 默认 fixture：我方乙 championId=0/pickState='none' → 未全部锁定
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('尚未结束')
  })

  it('禁止选人类建议 when stage 为 finalization（即使 pickState 数据未跟上）', async () => {
    const session = makeSessionData({})
    session.champSelect!.stage = 'finalization'
    const prompt = await buildChampSelectPrompt(session, 'ranked')
    expect(prompt).toContain('禁止给出任何选英雄')
  })

  it('includes 数据指标引用纪律（禁止出场率/ban率等未提供指标，区分英雄版本数据与玩家个人数据）', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('出场率')
    expect(prompt).toContain('版本胜率')
    expect(prompt).toContain('不是英雄的版本数据')
  })

  it('includes 禁止职能标签纪律', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('禁止给英雄贴')
    expect(prompt).toContain('主分路≠职能')
  })

  it('includes 我方本局分路 when assignedPosition present（LCU 小写命名）', async () => {
    const session = makeSessionData({})
    session.subteams[0].players[0] = makeMyPlayer({
      name: '我方甲',
      puuid: 'p1',
      championId: 103,
      pickState: 'locked',
      tierCn: '钻石IV',
      assignedPosition: 'middle'
    })
    const prompt = await buildChampSelectPrompt(session, 'ranked')
    expect(prompt).toContain('本局分路中单')
  })

  it('omits 本局分路 segment when assignedPosition absent（匹配/大乱斗无分配）', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    const myLine = prompt.split('\n').find(l => l.includes('我方甲'))
    expect(myLine).toBeDefined()
    expect(myLine).not.toContain('本局分路')
  })

  it('annotates 敌方主分路 as 推测（OP.GG 统计非本局权威）', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('主分路打野（推测）')
  })

  it('includes 分路一致性纪律：对线以我方本局分路为锚，禁止同一英雄前后分路矛盾', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('禁止同一英雄在不同章节出现不同分路')
  })

  it('includes 敌我前缀纪律：全文提英雄必须带我方/敌方前缀', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('必须带"我方/敌方"前缀')
  })

  it('lists 有改动英雄 in 【本版本英雄改动】 with 敌我前缀 + 方向 + 条目', async () => {
    vi.mocked(getChampionPatchNote).mockImplementation(async (id: number) => {
      if (id === 238)
        return {
          champion: '劫（7月16日更新）',
          direction: 'nerf',
          lines: ['Q - 影奥义！诸刃', '基础伤害：80 → 70']
        }
      if (id === 103)
        return {
          champion: '阿狸（7月16日更新）',
          direction: 'buff',
          lines: ['W - 妖异狐火', '冷却时间：9秒 → 8秒']
        }
      return null
    })
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('【本版本英雄改动】')
    expect(prompt).toContain('敌方劫｜削弱：Q - 影奥义！诸刃；基础伤害：80 → 70')
    expect(prompt).toContain('我方阿狸｜加强：W - 妖异狐火；冷却时间：9秒 → 8秒')
  })

  it('omits 无改动英雄 from 改动节（未列出即无改动）', async () => {
    vi.mocked(getChampionPatchNote).mockImplementation(async (id: number) =>
      id === 238
        ? { champion: '劫（7月16日更新）', direction: 'nerf', lines: ['基础伤害下调'] }
        : null
    )
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    const section = prompt.split('【本版本英雄改动】')[1].split('=====')[0]
    expect(section).toContain('敌方劫')
    expect(section).not.toContain('阿狸')
  })

  it('shows 固定句 when 双方英雄均无改动', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('双方英雄本版本均无官方改动')
  })

  it('truncates 超过 8 条的改动条目并加省略号', async () => {
    vi.mocked(getChampionPatchNote).mockImplementation(async (id: number) =>
      id === 238
        ? {
            champion: '劫（7月16日更新）',
            direction: 'adjusted',
            lines: ['条1', '条2', '条3', '条4', '条5', '条6', '条7', '条8', '条9', '条10']
          }
        : null
    )
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('敌方劫｜调整：条1；条2；条3；条4；条5；条6；条7；条8…')
    expect(prompt).not.toContain('条9')
  })

  it('includes 机制引用纪律例外：只准引用版本改动材料且禁止改写数字', async () => {
    const prompt = await buildChampSelectPrompt(makeSessionData({}), 'ranked')
    expect(prompt).toContain('唯一例外')
    expect(prompt).toContain('禁止改写或外推')
  })
})
