import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPlayerAnalysisPrompt } from '../team-player'
import { getChampionPatchNote } from '@renderer/services/patchNotes'

vi.mock('../../champion-names', () => ({
  getChampionName: vi.fn((id: number) => (id === 157 ? '疾风剑豪' : `英雄${id}`)),
  loadChampionNames: vi.fn(async () => {})
}))

vi.mock('@renderer/services/patchNotes', () => ({
  getChampionPatchNote: vi.fn(async () => null)
}))

vi.mock('../../shared/noteBrief', () => ({
  buildNoteBrief: vi.fn(() => undefined)
}))

function makePlayer() {
  return {
    championId: 157,
    assignedPosition: 'MIDDLE',
    summoner: { puuid: 'p1', gameName: '测试哥', tagLine: 'CN1', summonerLevel: 200 },
    matchHistory: { games: { games: [] } },
    userTag: {
      tag: [],
      recentData: {
        selectModeCn: '单双排位',
        selectWins: 6,
        selectLosses: 4,
        kda: 3.2,
        kills: 8.0,
        deaths: 4.0,
        assists: 6.0,
        groupRate: 55,
        damageDealtToChampionsRate: 28
      }
    },
    rank: { queueMap: { RANKED_SOLO_5x5: { tierCn: '翡翠I' } } }
  }
}

describe('buildPlayerAnalysisPrompt', () => {
  beforeEach(() => {
    vi.mocked(getChampionPatchNote).mockReset()
    vi.mocked(getChampionPatchNote).mockResolvedValue(null)
  })

  it('includes 基本信息与近期统计', async () => {
    const prompt = await buildPlayerAnalysisPrompt(makePlayer())
    expect(prompt).toContain('测试哥')
    expect(prompt).toContain('翡翠I')
    expect(prompt).toContain('单双排位')
  })

  it('includes 本局英雄与本局分路', async () => {
    const prompt = await buildPlayerAnalysisPrompt(makePlayer())
    expect(prompt).toContain('本局英雄：疾风剑豪')
    expect(prompt).toContain('本局分路：中单')
  })

  it('shows 无分路 fallback when assignedPosition 为空', async () => {
    const p = makePlayer()
    p.assignedPosition = ''
    const prompt = await buildPlayerAnalysisPrompt(p)
    expect(prompt).toContain('本局分路：无（该模式无分路概念或未获取）')
  })

  it('includes 该英雄本版本改动 when 有改动', async () => {
    vi.mocked(getChampionPatchNote).mockResolvedValue({
      champion: '疾风剑豪（7月16日更新）',
      direction: 'nerf',
      lines: ['Q 冷却 4→5']
    })
    const prompt = await buildPlayerAnalysisPrompt(makePlayer())
    expect(prompt).toContain('本局英雄本版本改动')
    expect(prompt).toContain('削弱：Q 冷却 4→5')
  })

  it('shows 无改动固定句 when 该英雄无改动', async () => {
    const prompt = await buildPlayerAnalysisPrompt(makePlayer())
    expect(prompt).toContain('本局英雄本版本无官方改动')
  })

  it('includes 纪律硬规则（禁编造机制唯一例外/禁职能标签/指标名）', async () => {
    const prompt = await buildPlayerAnalysisPrompt(makePlayer())
    expect(prompt).toContain('唯一例外')
    expect(prompt).toContain('主分路≠职能')
    expect(prompt).toContain('禁止编造')
  })
})
