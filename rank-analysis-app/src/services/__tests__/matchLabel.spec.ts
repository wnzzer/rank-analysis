/**
 * 对局标注的模型对比纯函数：模型选择、快照、「你 vs 模型」文案。
 * 局面取自 2026-11-14 真机标注第 4 局（胜方蓝 100、败方红 200）。
 */
import { describe, expect, it } from 'vitest'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'
import { buildModelSnapshot, compareText, modelPicks, toPick } from '../matchLabel'

function p(
  participantId: number,
  champion: string,
  total: number,
  win: boolean,
  position = 'TOP'
): PlayerView {
  return {
    participantId,
    teamId: win ? 100 : 200,
    side: win ? 'blue' : 'red',
    name: '',
    champion,
    championId: participantId * 10,
    isMe: false,
    win,
    kills: 0,
    deaths: 0,
    assists: 0,
    position,
    roleCn: '',
    label: '正常',
    total,
    rank: null,
    parts: [],
    flags: [],
    deathList: null,
    deathCounts: null,
    deathSummary: '',
    items: [],
    opponentId: null
  } as PlayerView
}

const players = [
  p(1, '贝蕾亚', 0.47, true, 'JUNGLE'),
  p(2, '德莱厄斯', 0.29, true),
  p(3, '玛尔扎哈', 0.25, true, 'MIDDLE'),
  p(4, '诺提勒斯', 0.24, true, 'UTILITY'),
  p(5, '维克托', -0.37, true, 'BOTTOM'),
  p(6, '卡莎', 0.17, false, 'BOTTOM'),
  p(7, '莫甘娜', 0.02, false, 'UTILITY'),
  p(8, '辛德拉', -0.47, false, 'MIDDLE'),
  p(9, '安蓓萨', -0.51, false, 'JUNGLE'),
  p(10, '武器大师', -0.56, false)
]

describe('modelPicks', () => {
  it('最关键取全场最高，最犯罪取败方最低（胜方维克托更低也不算）', () => {
    expect(modelPicks(players)).toEqual({ keyPid: 1, blamePid: 10 })
  })
  it('没有败方或没有玩家时为 null', () => {
    expect(modelPicks(players.filter(x => x.win)).blamePid).toBeNull()
    expect(modelPicks([])).toEqual({ keyPid: null, blamePid: null })
  })
})

describe('compareText', () => {
  it('一致', () => {
    expect(compareText('key', 1, players)).toEqual({ agree: true, text: '模型也选了贝蕾亚' })
    expect(compareText('blame', 10, players).agree).toBe(true)
  })
  it('不一致时写出模型的人和你选的人在队内的名次', () => {
    expect(compareText('blame', 8, players)).toEqual({
      agree: false,
      text: '模型选的是武器大师（辛德拉排败方倒数第 3）'
    })
    expect(compareText('key', 2, players)).toEqual({
      agree: false,
      text: '模型选的是贝蕾亚（德莱厄斯排胜方第 2）'
    })
  })
  it('选了胜方的人当犯罪：按胜方倒数排', () => {
    expect(compareText('blame', 5, players).text).toBe('模型选的是武器大师（维克托排胜方倒数第 1）')
  })
  it('模型没有结论时 agree 为 null', () => {
    expect(
      compareText(
        'blame',
        1,
        players.filter(x => x.win)
      )
    ).toEqual({
      agree: null,
      text: '模型结论未就绪'
    })
  })
})

describe('快照', () => {
  it('toPick 不含名字', () => {
    expect(toPick(players[0])).toEqual({ slot: 1, teamId: 100, championId: 10, position: 'JUNGLE' })
  })
  it('buildModelSnapshot 带 10 人总分（两位小数）与模型选择', () => {
    const s = buildModelSnapshot(players)
    expect(s.players).toHaveLength(10)
    expect(s.players[9]).toMatchObject({ slot: 10, total: -0.56, label: '正常' })
    expect([s.keySlot, s.blameSlot]).toEqual([1, 10])
    expect(JSON.stringify(s)).not.toMatch(/name|puuid/)
  })
})
