import { describe, it, expect } from 'vitest'
import { computeRoleBenchmark, computeVsLaneOpponent, type LaneFactPlayer } from '../laneFacts'

function player(
  o: Partial<LaneFactPlayer> & Pick<LaneFactPlayer, 'participantId' | 'teamId'>
): LaneFactPlayer {
  return {
    name: `玩家${o.participantId}`,
    champion: '英雄',
    teamPosition: 'BOTTOM',
    kills: 5,
    deaths: 5,
    kda: 2,
    gold: 12000,
    cs: 200,
    damageShare: 25,
    goldShare: 24,
    killParticipation: 60,
    damageTakenShare: 15,
    csm: 8,
    ...o
  }
}

describe('computeVsLaneOpponent', () => {
  it('should diff against same-position enemy (self minus opponent)', () => {
    const me = player({
      participantId: 4,
      teamId: 100,
      gold: 16800,
      cs: 290,
      kda: 7.5,
      kills: 12,
      deaths: 2,
      damageShare: 32.5
    })
    const opp = player({
      participantId: 9,
      teamId: 200,
      champion: '韦鲁斯',
      gold: 9800,
      cs: 200,
      kda: 0.88,
      kills: 2,
      deaths: 8,
      damageShare: 20.3
    })
    const ally = player({ participantId: 5, teamId: 100, teamPosition: 'UTILITY' })

    expect(computeVsLaneOpponent(me, [me, opp, ally])).toEqual({
      opponentName: '玩家9',
      opponentChampion: '韦鲁斯',
      goldDiff: 7000,
      csDiff: 90,
      kdaDiff: 6.62,
      killsDiff: 10,
      deathsDiff: -6,
      damageShareDiff: 12.2
    })
  })

  it('should return null without lane or opponent', () => {
    const me = player({ participantId: 1, teamId: 100, teamPosition: 'UNKNOWN' })
    expect(
      computeVsLaneOpponent(me, [
        me,
        player({ participantId: 6, teamId: 200, teamPosition: 'UNKNOWN' })
      ])
    ).toBeNull()
    const top = player({ participantId: 1, teamId: 100, teamPosition: 'TOP' })
    expect(
      computeVsLaneOpponent(top, [
        top,
        player({ participantId: 6, teamId: 200, teamPosition: 'JUNGLE' })
      ])
    ).toBeNull()
  })
})

describe('computeRoleBenchmark', () => {
  it('should treat low support damage as normal duty, but flag low ADC damage', () => {
    const sup = computeRoleBenchmark(
      player({
        participantId: 5,
        teamId: 100,
        teamPosition: 'UTILITY',
        damageShare: 8,
        goldShare: 13,
        csm: 1.2
      })
    )
    expect(sup).toMatchObject({ damageShare: 'normal', goldShare: 'normal', csm: 'normal' })

    const adc = computeRoleBenchmark(
      player({ participantId: 4, teamId: 100, teamPosition: 'BOTTOM', damageShare: 8 })
    )
    expect(adc?.damageShare).toBe('low')
  })

  it('should flag high values above the role range', () => {
    const mid = computeRoleBenchmark(
      player({ participantId: 3, teamId: 100, teamPosition: 'MIDDLE', damageShare: 36.8 })
    )
    expect(mid?.damageShare).toBe('high')
  })

  it('should return null for unknown position', () => {
    expect(
      computeRoleBenchmark(player({ participantId: 1, teamId: 100, teamPosition: 'UNKNOWN' }))
    ).toBeNull()
  })
})
