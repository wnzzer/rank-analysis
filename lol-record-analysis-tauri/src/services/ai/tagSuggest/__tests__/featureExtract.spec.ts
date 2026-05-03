import { describe, it, expect } from 'vitest'
import { gameToFeature, splitWinsLosses, queueIdToName } from '../featureExtract'

/** 最小化辅助：构造只含 queueId 的 RawGame，其余字段使用默认值 */
function makeGame(queueId: number) {
  return {
    gameId: 1,
    queueId,
    gameDuration: 1200,
    participants: [{ championId: 1, stats: { win: true, kills: 0, deaths: 0, assists: 0 } }],
    participantIdentities: [{ player: { puuid: 'me' } }]
  }
}

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
      queueName: '排位模式',
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

  it('attaches queueName from injected map', () => {
    const game = makeGame(420)
    const f = gameToFeature(game, 'me', { 420: '单双排' })
    expect(f?.queueName).toBe('单双排')
  })

  it('uses categorization fallback when no map provided', () => {
    const game = makeGame(420)
    const f = gameToFeature(game, 'me')
    expect(f?.queueName).toBe('排位模式')
  })

  it('falls back to 娱乐模式 for unknown queueIds without map', () => {
    const f = gameToFeature(makeGame(99999), 'me')
    expect(f?.queueName).toBe('娱乐模式')
  })
})

describe('queueIdToName', () => {
  it('returns specific name from injected map (大乱斗)', () => {
    expect(queueIdToName(450, { 450: '大乱斗' })).toBe('大乱斗')
  })

  it('returns 排位模式 for ranked id without map', () => {
    expect(queueIdToName(420)).toBe('排位模式')
  })

  it('returns 匹配模式 for matchmaking id without map', () => {
    expect(queueIdToName(430)).toBe('匹配模式')
  })

  it('falls back to 娱乐模式 for unmapped non-ranked id', () => {
    expect(queueIdToName(987654)).toBe('娱乐模式')
  })

  it('injected map takes priority over categorization', () => {
    // Even if 420 is "ranked" by category, an injected name should win.
    expect(queueIdToName(420, { 420: '单双排' })).toBe('单双排')
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
