/** games.jsonl 容错解析与 SUMMARY → 打分输入 */
import { describe, it, expect } from 'vitest'
import { parseGamesJsonl, toScoringInputs, type SummaryGame } from '../corpus'

const part = (participantId: number, over: Record<string, unknown> = {}) => ({
  participantId,
  teamId: participantId <= 5 ? 100 : 200,
  puuid: `p${participantId}`,
  championId: participantId,
  win: participantId <= 5,
  kills: 2,
  deaths: 1,
  assists: 3,
  totalDamageDealtToChampions: 12000,
  goldEarned: 6000,
  totalMinionsKilled: 100,
  neutralMinionsKilled: 20,
  visionScore: 15,
  damageDealtToObjectives: 3000,
  timeCCingOthers: 10,
  teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][(participantId - 1) % 5],
  ...over
})
const g = (gameId: number, queueId = 420, gameDuration = 1200): SummaryGame => ({
  gameId,
  platformId: 'TJ100',
  queueId,
  gameDuration,
  gameVersion: '16.22.836.1077',
  participants: Array.from({ length: 10 }, (_, i) => part(i + 1))
})

describe('parseGamesJsonl', () => {
  it('跳过半行/坏行、重复 gameId、非目标队列与 <5 分钟局', () => {
    const text = [
      JSON.stringify(g(1)),
      JSON.stringify(g(1)),
      JSON.stringify(g(2, 1700)),
      JSON.stringify(g(3, 420, 200)),
      'not json',
      JSON.stringify(g(4, 450)),
      JSON.stringify(g(5)).slice(0, 50)
    ].join('\n')
    expect(parseGamesJsonl(text).map(x => x.gameId)).toEqual([1, 4])
  })
})

describe('toScoringInputs', () => {
  it('终局指标、位置与胜负', () => {
    const inputs = toScoringInputs(g(1), null)
    expect(inputs).toHaveLength(10)
    const p1 = inputs[0]
    expect(p1.position).toBe('TOP')
    expect(p1.win).toBe(true)
    expect(p1.timeline).toBeNull()
    expect(p1.deaths).toBeNull()
    expect(p1.end.gpm).toBeCloseTo(300)
    expect(p1.end.killParticipation).toBeCloseTo(0.5)
    expect(p1.end.objectiveDamagePerMin).toBeCloseTo(150)
  })
  it('无分路队列位置记为空串', () => {
    expect(toScoringInputs(g(4, 450), null)[0].position).toBe('')
  })
})
