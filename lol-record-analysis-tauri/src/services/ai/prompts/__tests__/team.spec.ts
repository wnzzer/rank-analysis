import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildTeamAnalysisPrompt } from '../team'
import { findCounterHints } from '@renderer/services/opgg'
import { getChampionPatchNote } from '@renderer/services/patchNotes'

const CHAMP_NAMES: Record<number, string> = {
  64: '盲僧',
  103: '阿狸',
  157: '疾风剑豪',
  21: '赏金猎人'
}

vi.mock('../../champion-names', () => ({
  getChampionName: vi.fn((id: number) => CHAMP_NAMES[id] || `英雄${id}`),
  loadChampionNames: vi.fn(async () => {})
}))

vi.mock('@renderer/services/patchNotes', () => ({
  getChampionPatchNote: vi.fn(async () => null)
}))

vi.mock('@renderer/services/opgg', () => ({
  getChampionMeta: vi.fn(async (_mode: string, id: number) =>
    id === 157 ? { championId: 157, position: 'MIDDLE', tier: 4, winRate: 0.48 } : null
  ),
  getLaneCounters: vi.fn(async () => ({})),
  findCounterHints: vi.fn(() => [])
}))

vi.mock('../../shared/noteBrief', () => ({
  buildNoteBrief: vi.fn(() => undefined)
}))

/** 会话玩家（SessionSummoner 形状的最小充分集） */
function makePlayer(opts: {
  name: string
  puuid: string
  championId: number
  assignedPosition?: string
  preGroupName?: string
  meetGames?: Array<{ isMyTeam: boolean; win: boolean }>
}) {
  return {
    championId: opts.championId,
    summoner: { puuid: opts.puuid, gameName: opts.name, tagLine: 'CN1', summonerLevel: 100 },
    matchHistory: { games: { games: [] } },
    userTag: { tag: [], recentData: { selectWins: 6, selectLosses: 4, kda: 3.0 } },
    rank: { queueMap: { RANKED_SOLO_5x5: { tierCn: '铂金II' } } },
    meetGames: (opts.meetGames ?? []).map((m, i) => ({
      index: i,
      gameId: i,
      puuid: opts.puuid,
      gameCreatedAt: '',
      isMyTeam: m.isMyTeam,
      gameName: opts.name,
      tagLine: 'CN1',
      championId: opts.championId,
      championKey: '',
      kills: 1,
      deaths: 1,
      assists: 1,
      win: m.win
    })),
    preGroupMarkers: { name: opts.preGroupName ?? '', type: 'info' },
    pickState: '',
    assignedPosition: opts.assignedPosition ?? ''
  }
}

function makeSessionData() {
  return {
    typeCn: '单双排位',
    isMultiTeam: false,
    mySubteamId: 1,
    subteams: [
      {
        subteamId: 1,
        players: [
          makePlayer({ name: '我方甲', puuid: 'p1', championId: 103, assignedPosition: 'MIDDLE' }),
          makePlayer({
            name: '我方乙',
            puuid: 'p2',
            championId: 64,
            assignedPosition: 'JUNGLE',
            preGroupName: '队伍1'
          }),
          makePlayer({
            name: '我方丙',
            puuid: 'p3',
            championId: 21,
            assignedPosition: 'BOTTOM',
            preGroupName: '队伍1'
          })
        ]
      },
      {
        subteamId: 2,
        players: [
          makePlayer({
            name: '敌方甲',
            puuid: 'e1',
            championId: 157,
            assignedPosition: 'MIDDLE',
            meetGames: [
              { isMyTeam: true, win: true },
              { isMyTeam: false, win: false }
            ]
          })
        ]
      }
    ]
  }
}

describe('buildTeamAnalysisPrompt', () => {
  beforeEach(() => {
    vi.mocked(findCounterHints).mockReset()
    vi.mocked(findCounterHints).mockReturnValue([])
    vi.mocked(getChampionPatchNote).mockReset()
    vi.mocked(getChampionPatchNote).mockResolvedValue(null)
  })

  it('includes 双方玩家画像与模式', async () => {
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), { opggMode: 'ranked' })
    expect(prompt).toContain('单双排位')
    expect(prompt).toContain('我方甲')
    expect(prompt).toContain('敌方甲')
  })

  it('includes 本局分路（currentLane 中文，来自 assignedPosition）', async () => {
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), { opggMode: 'ranked' })
    expect(prompt).toContain('"currentLane":"中单"')
    expect(prompt).toContain('"currentLane":"打野"')
  })

  it('includes 预组队情报区块（按 marker name 分组列名单）', async () => {
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), { opggMode: 'ranked' })
    expect(prompt).toContain('【预组队情报】')
    expect(prompt).toContain('我方：队伍1（我方乙、我方丙）')
  })

  it('shows 无预组队固定句 when 没有 marker', async () => {
    const session = makeSessionData()
    for (const st of session.subteams) for (const p of st.players) p.preGroupMarkers.name = ''
    const prompt = await buildTeamAnalysisPrompt(session, { opggMode: 'ranked' })
    expect(prompt).toContain('未检测到预组队')
  })

  it('includes 遇见过区块（次数与同队/对阵拆分）', async () => {
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), { opggMode: 'ranked' })
    expect(prompt).toContain('【遇见过的玩家】')
    expect(prompt).toContain('敌方甲：遇见过 2 次（同队 1，对阵 1）')
  })

  it('includes 敌方英雄版本情报（OP.GG T级/胜率/主分路推测）', async () => {
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), { opggMode: 'ranked' })
    expect(prompt).toContain('【敌方英雄版本情报】')
    expect(prompt).toContain('疾风剑豪｜T4/胜率48.0%')
    expect(prompt).toContain('主分路中单（推测）')
  })

  it('omits 敌方英雄版本情报 when opggMode 未提供', async () => {
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), {})
    expect(prompt).not.toContain('【敌方英雄版本情报】')
  })

  it('includes 版本改动区块（有改动英雄带敌我前缀）', async () => {
    vi.mocked(getChampionPatchNote).mockImplementation(async (id: number) =>
      id === 157
        ? { champion: '疾风剑豪（7月16日更新）', direction: 'nerf', lines: ['Q 冷却 4→5'] }
        : null
    )
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), { opggMode: 'ranked' })
    expect(prompt).toContain('【本版本英雄改动】')
    expect(prompt).toContain('敌方疾风剑豪｜削弱：Q 冷却 4→5')
  })

  it('includes 分析纪律硬规则（敌我前缀/禁职能标签/机制引用唯一例外/分路只认材料）', async () => {
    const prompt = await buildTeamAnalysisPrompt(makeSessionData(), { opggMode: 'ranked' })
    expect(prompt).toContain('必须带"我方/敌方"前缀')
    expect(prompt).toContain('主分路≠职能')
    expect(prompt).toContain('唯一例外')
    expect(prompt).toContain('currentLane')
  })
})
