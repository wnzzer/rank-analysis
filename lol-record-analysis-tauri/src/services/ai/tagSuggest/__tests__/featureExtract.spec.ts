import { describe, it, expect } from 'vitest'
import { gameToFeature, splitWinsLosses } from '../featureExtract'

describe('gameToFeature', () => {
  it('extracts core fields from a participant', () => {
    const game = {
      gameId: 1,
      queueId: 420,
      gameDuration: 1800, // 30 min
      participants: [
        {
          championId: 157,
          stats: {
            win: true,
            kills: 10,
            deaths: 2,
            assists: 8,
            totalDamageDealtToChampions: 30000,
            goldEarned: 12000
          }
        }
      ],
      participantIdentities: [{ player: { puuid: 'me' } }]
    }
    const f = gameToFeature(game, 'me')
    expect(f).toMatchObject({
      championId: 157,
      win: true,
      kda: { k: 10, d: 2, a: 8 },
      queueId: 420,
      durationMin: 30
    })
    expect(f!.kda.ratio).toBeCloseTo(9, 1)
  })

  it('handles 0 deaths without divide-by-zero', () => {
    const game = {
      gameId: 1,
      queueId: 420,
      gameDuration: 1500,
      participants: [{ championId: 1, stats: { win: true, kills: 5, deaths: 0, assists: 3 } }],
      participantIdentities: [{ player: { puuid: 'me' } }]
    }
    const f = gameToFeature(game, 'me')
    expect(Number.isFinite(f!.kda.ratio)).toBe(true)
    expect(f!.kda.ratio).toBe(8) // (5+3)/1 — convention: deaths=0 → use 1
  })

  it('returns null when puuid not in game', () => {
    const game = {
      gameId: 1,
      queueId: 420,
      gameDuration: 1500,
      participants: [{ championId: 1, stats: { win: true, kills: 0, deaths: 0, assists: 0 } }],
      participantIdentities: [{ player: { puuid: 'someone-else' } }]
    }
    expect(gameToFeature(game, 'me')).toBeNull()
  })
})

describe('splitWinsLosses', () => {
  it('partitions by win field', () => {
    const features = [
      { win: true, championId: 1 },
      { win: false, championId: 2 },
      { win: true, championId: 3 }
    ] as any
    const { wins, losses } = splitWinsLosses(features)
    expect(wins).toHaveLength(2)
    expect(losses).toHaveLength(1)
  })
})
