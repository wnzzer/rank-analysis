/**
 * 快照里的评分输入：玩家行新字段、时间线死亡归责与指标。
 */
import { describe, it, expect } from 'vitest'
import { buildMatchSnapshot } from '../snapshot'
import { makeScoringGame, makeScoringTimeline } from './scoringFixtures'

describe('snapshot scoring inputs', () => {
  it('玩家行带 championId / objectiveDamage / ccSeconds', () => {
    const snap = buildMatchSnapshot(makeScoringGame())
    expect(snap.players[2].championId).toBe(3)
    expect(snap.players[2].objectiveDamage).toBe(3000)
    expect(snap.players[2].ccSeconds).toBe(6)
    expect(snap.timeline).toBeUndefined()
  })

  it('有时间线：deaths 与 metrics', () => {
    const snap = buildMatchSnapshot(makeScoringGame(), undefined, makeScoringTimeline())
    expect(snap.timeline?.deaths).toEqual([
      { victimId: 6, timestamp: 300000, kind: 'solo', responsibility: 1, consequence: 1 }
    ])
    expect(snap.timeline?.metrics[6].deathCostPerMin).toBeCloseTo(1 / 30)
    expect(snap.timeline?.metrics[1].controlWardsPerMin).toBe(0)
  })

  describe('SGP 终局指标优先于 LCU', () => {
    const withSgp = () => {
      const tl = makeScoringTimeline()
      tl.participants = [
        {
          participantId: 3,
          puuid: 'puuid-3',
          visionScore: 55,
          damageDealtToObjectives: 777,
          timeCCingOthers: 42
        }
      ]
      return tl
    }

    it('时间线有值时覆盖 LCU', () => {
      const snap = buildMatchSnapshot(makeScoringGame(), undefined, withSgp())
      expect(snap.players[2].objectiveDamage).toBe(777)
      expect(snap.players[2].ccSeconds).toBe(42)
      expect(snap.players[2].wardScore).toBe(55)
      // 时间线没覆盖到的玩家仍用 LCU
      expect(snap.players[3].objectiveDamage).toBe(4000)
    })

    it('无时间线时回退 LCU', () => {
      const snap = buildMatchSnapshot(makeScoringGame())
      expect(snap.players[2].objectiveDamage).toBe(3000)
      expect(snap.players[2].ccSeconds).toBe(6)
      expect(snap.players[2].wardScore).toBe(20)
    })

    it('两边都没有为 null', () => {
      const game = makeScoringGame() as any
      delete game.participants[2].stats.damageDealtToObjectives
      delete game.participants[2].stats.timeCCingOthers
      delete game.participants[2].stats.visionScore
      const snap = buildMatchSnapshot(game, undefined, makeScoringTimeline())
      expect(snap.players[2].objectiveDamage).toBeNull()
      expect(snap.players[2].ccSeconds).toBeNull()
      expect(snap.players[2].wardScore).toBeNull()
    })
  })
})
