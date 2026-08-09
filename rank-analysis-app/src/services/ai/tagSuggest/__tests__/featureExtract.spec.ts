import { describe, it, expect } from 'vitest'
import { gameToFeature, type RawGame } from '../featureExtract'

function rawGame(
  opts: {
    puuid?: string
    queueId?: number
    duration?: number
    meChampionId?: number
    meTeamPosition?: string
    meStats?: Record<string, number | boolean>
    teamMate1Stats?: Record<string, number | boolean>
    meSpell1?: number
    meSpell2?: number
  } = {}
): RawGame {
  return {
    gameId: 1,
    queueId: opts.queueId ?? 420,
    gameDuration: opts.duration ?? 1800, // 30 minutes default
    participants: [
      {
        championId: opts.meChampionId ?? 64,
        teamId: 100,
        teamPosition: opts.meTeamPosition ?? 'JUNGLE',
        spell1Id: opts.meSpell1 ?? 4,
        spell2Id: opts.meSpell2 ?? 11,
        stats: {
          win: true,
          kills: 10,
          deaths: 5,
          assists: 15,
          totalDamageDealtToChampions: 30000,
          goldEarned: 15000,
          totalMinionsKilled: 150,
          neutralMinionsKilled: 50,
          totalDamageTaken: 20000,
          visionScore: 24,
          doubleKills: 1,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          ...(opts.meStats ?? {})
        }
      },
      {
        championId: 86,
        teamId: 100,
        teamPosition: 'TOP',
        spell1Id: 4,
        spell2Id: 12,
        stats: {
          win: true,
          kills: 5,
          deaths: 3,
          assists: 10,
          totalDamageDealtToChampions: 20000,
          goldEarned: 12000,
          totalMinionsKilled: 200,
          neutralMinionsKilled: 0,
          totalDamageTaken: 30000,
          visionScore: 18,
          doubleKills: 0,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          ...(opts.teamMate1Stats ?? {})
        }
      }
    ],
    participantIdentities: [
      { player: { puuid: opts.puuid ?? 'me' } },
      { player: { puuid: 'mate1' } }
    ]
  } as unknown as RawGame
}

describe('gameToFeature — basic fields preserved', () => {
  it('returns existing fields unchanged', () => {
    const f = gameToFeature(rawGame(), 'me')!
    expect(f.win).toBe(true)
    expect(f.championId).toBe(64)
    expect(f.queueId).toBe(420)
    expect(f.durationMin).toBe(30)
    expect(f.kda.k).toBe(10)
    expect(f.kda.d).toBe(5)
    expect(f.kda.a).toBe(15)
    expect(f.kda.ratio).toBe(5) // (10 + 15) / 5
    expect(f.damage).toBe(30000)
    expect(f.gold).toBe(15000)
  })

  it('returns null when puuid not in game', () => {
    expect(gameToFeature(rawGame(), 'ghost')).toBeNull()
  })
})

describe('gameToFeature — new aggregate fields', () => {
  it('cs = totalMinionsKilled + neutralMinionsKilled', () => {
    const f = gameToFeature(rawGame(), 'me')!
    expect(f.cs).toBe(200)
  })

  it('killParticipation = (kills+assists)/teamKills, capped [0,1]', () => {
    // team kills = 10 + 5 = 15; my (k+a) = 10 + 15 = 25 → ratio 25/15 = 1.0 (capped)
    const f = gameToFeature(rawGame(), 'me')!
    expect(f.killParticipation).toBe(1)
  })

  it('damageShare = my damage / team damage', () => {
    // team damage = 30000 + 20000 = 50000; mine = 30000 → 0.6
    const f = gameToFeature(rawGame(), 'me')!
    expect(f.damageShare).toBeCloseTo(0.6, 2)
  })

  it('damageTakenShare = my taken / team taken', () => {
    // team taken = 20000 + 30000 = 50000; mine = 20000 → 0.4
    const f = gameToFeature(rawGame(), 'me')!
    expect(f.damageTakenShare).toBeCloseTo(0.4, 2)
  })

  it('wardScore reads visionScore', () => {
    const f = gameToFeature(rawGame(), 'me')!
    expect(f.wardScore).toBe(24)
  })

  it('multiKillsMax = highest of double/triple/quadra/penta', () => {
    const f1 = gameToFeature(rawGame({ meStats: { doubleKills: 1 } }), 'me')!
    expect(f1.multiKillsMax).toBe(2)
    const f2 = gameToFeature(rawGame({ meStats: { doubleKills: 1, tripleKills: 1 } }), 'me')!
    expect(f2.multiKillsMax).toBe(3)
    const f3 = gameToFeature(rawGame({ meStats: { doubleKills: 1, quadraKills: 1 } }), 'me')!
    expect(f3.multiKillsMax).toBe(4)
    const f4 = gameToFeature(rawGame({ meStats: { pentaKills: 1 } }), 'me')!
    expect(f4.multiKillsMax).toBe(5)
    const f5 = gameToFeature(
      rawGame({
        meStats: { doubleKills: 0, tripleKills: 0, quadraKills: 0, pentaKills: 0 }
      }),
      'me'
    )!
    expect(f5.multiKillsMax).toBe(0)
  })
})

describe('gameToFeature — per-minute metrics', () => {
  it('dpm = damage / minutes', () => {
    const f = gameToFeature(rawGame({ duration: 1800 }), 'me')!
    expect(f.dpm).toBe(1000) // 30000 / 30
  })

  it('gpm = gold / minutes', () => {
    const f = gameToFeature(rawGame({ duration: 1800 }), 'me')!
    expect(f.gpm).toBe(500) // 15000 / 30
  })

  it('csm = cs / minutes', () => {
    const f = gameToFeature(rawGame({ duration: 1800 }), 'me')!
    expect(f.csm).toBeCloseTo(200 / 30, 2)
  })

  it('zero-duration safety: dpm/gpm/csm = 0', () => {
    const f = gameToFeature(rawGame({ duration: 0 }), 'me')!
    expect(f.dpm).toBe(0)
    expect(f.gpm).toBe(0)
    expect(f.csm).toBe(0)
  })
})

describe('gameToFeature — position fields', () => {
  it('passes through teamPosition when LCU provides it', () => {
    const f = gameToFeature(rawGame({ meTeamPosition: 'MIDDLE' }), 'me')!
    expect(f.teamPosition).toBe('MIDDLE')
  })

  it('teamPosition NONE → inferTeamPosition fallback (Smite → JUNGLE)', () => {
    const f = gameToFeature(rawGame({ meTeamPosition: 'NONE', meSpell1: 4, meSpell2: 11 }), 'me')!
    expect(f.teamPosition).toBe('JUNGLE')
  })

  it('teamPosition empty + unknown → UNKNOWN', () => {
    const f = gameToFeature(
      rawGame({
        meTeamPosition: '',
        meSpell1: 4,
        meSpell2: 14,
        meChampionId: 9999999
      }),
      'me'
    )!
    expect(f.teamPosition).toBe('UNKNOWN')
  })

  it('lane reads timeline.lane (defaults empty string)', () => {
    const f = gameToFeature(rawGame(), 'me')!
    // timeline.lane is not set in the fixture → empty string
    expect(f.lane).toBe('')
  })
})
