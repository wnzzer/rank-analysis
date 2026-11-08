/**
 * 快照适配与必出名单选择。
 */
import { describe, it, expect } from 'vitest'
import { buildMatchSnapshot } from '../../snapshot'
import {
  EMPTY_SCORING_DATA as EMPTY_DATA,
  makeScoringGame,
  makeScoringTimeline
} from '../../__tests__/scoringFixtures'
import { scoreSnapshot, selectVerdicts, type VerdictCandidate } from '../match'
import type { PlayerScore } from '../scorePlayers'
import type { VerdictLabel } from '../../../matchDetail/types'

describe('scoreSnapshot', () => {
  it('每位玩家一个分数，顺序与快照一致；无时间线 deaths 为 null', () => {
    const snap = buildMatchSnapshot(makeScoringGame())
    const scores = scoreSnapshot(snap, EMPTY_DATA)
    expect(scores.map(s => s.participantId)).toEqual(snap.players.map(p => p.participantId))
    expect(scores.every(s => s.deaths === null)).toBe(true)
  })
  it('有时间线：死者的 deaths 来自快照归责', () => {
    const snap = buildMatchSnapshot(makeScoringGame(), undefined, makeScoringTimeline())
    const s6 = scoreSnapshot(snap, EMPTY_DATA).find(s => s.participantId === 6)!
    expect(s6.deaths?.map(d => d.kind)).toEqual(['solo'])
  })
})

const score = (participantId: number, label: VerdictLabel, total: number): PlayerScore => ({
  participantId,
  total,
  band: '',
  sub: {
    lane: null,
    teamfight: null,
    deathQuality: null,
    growth: null,
    resources: null,
    vision: null
  },
  contributions: {},
  mitigation: { mitigated: false, reasons: [] },
  label,
  deaths: null
})
const KILLS = [10, 2, 3, 1, 0, 9, 4, 2, 1, 0]
const DEATHS = [1, 2, 3, 4, 9, 1, 2, 8, 3, 4]
const cand = (isMe: number): VerdictCandidate[] =>
  KILLS.map((kills, i) => ({
    participantId: i + 1,
    teamId: i < 5 ? 100 : 200,
    isMe: i + 1 === isMe,
    kills,
    deaths: DEATHS[i],
    kda: 2
  }))

describe('selectVerdicts', () => {
  it('必出 = 本人 + 每队击杀/死亡第一 + 所有非正常；按影响力排序', () => {
    const totals = [0.5, 0.1, 0.6, 0, -0.4, 0.9, -1.3, -0.2, 0, 0]
    const labels: VerdictLabel[] = [
      '正常',
      '正常',
      '被连累',
      '正常',
      '正常',
      '正常',
      '犯罪',
      '正常',
      '正常',
      '正常'
    ]
    const out = selectVerdicts(
      cand(2),
      totals.map((t, i) => score(i + 1, labels[i], t))
    )
    expect(out.map(v => v.participantId)).toEqual([7, 3, 6, 1, 5, 8, 2])
    expect(out.every(v => v.mustInclude)).toBe(true)
  })
  it('超过 7 人时裁到 7 且保留本人', () => {
    const out = selectVerdicts(
      cand(10),
      Array.from({ length: 10 }, (_, i) => score(i + 1, '犯罪', i === 9 ? 0 : i + 1))
    )
    expect(out).toHaveLength(7)
    expect(out.map(v => v.participantId)).toContain(10)
  })
  it('必出不足 4 人时用正常补到 4；总人数不足 4 时全员', () => {
    const out = selectVerdicts(
      cand(1),
      Array.from({ length: 10 }, (_, i) => score(i + 1, '正常', 0))
    )
    expect(out.map(v => v.participantId).sort((a, b) => a - b)).toEqual([1, 5, 6, 8])
    const three = selectVerdicts(
      cand(1).slice(0, 3),
      [1, 2, 3].map(id => score(id, '正常', 0))
    )
    expect(three).toHaveLength(3)
  })
})
