import { describe, it, expect } from 'vitest'
import { remapTimeline, buildPuuidMap } from '../remap'
import type { SlimTimeline } from '../types'
import type { Game } from '@renderer/types/domain/match'

const tl: SlimTimeline = {
  gameId: 1,
  frameIntervalMs: 60000,
  participants: [
    { participantId: 1, puuid: 'a' },
    { participantId: 2, puuid: 'b' }
  ],
  frames: [
    {
      timestamp: 0,
      players: [
        {
          participantId: 1,
          totalGold: 500,
          xp: 0,
          level: 1,
          cs: 0,
          jungleCs: 0,
          x: 0,
          y: 0,
          damageToChampions: 0
        },
        {
          participantId: 2,
          totalGold: 600,
          xp: 0,
          level: 1,
          cs: 0,
          jungleCs: 0,
          x: 0,
          y: 0,
          damageToChampions: 0
        }
      ]
    }
  ],
  events: [
    {
      type: 'CHAMPION_KILL',
      timestamp: 1000,
      killerId: 1,
      victimId: 2,
      assisting: [2],
      x: 0,
      y: 0,
      bounty: 300,
      shutdownBounty: 0,
      damageReceived: [{ participantId: 1, total: 100, topSlot: 0 }]
    },
    { type: 'WARD_PLACED', timestamp: 2000, creatorId: 2, wardType: 'YELLOW_TRINKET' }
  ],
  items: {}
}

describe('remapTimeline', () => {
  it('should swap participant ids by puuid', () => {
    const out = remapTimeline(
      tl,
      new Map([
        ['a', 2],
        ['b', 1]
      ])
    )
    expect(out.participants).toEqual([
      { participantId: 2, puuid: 'a' },
      { participantId: 1, puuid: 'b' }
    ])
    expect(out.frames[0].players.map(p => [p.participantId, p.totalGold])).toEqual([
      [1, 600],
      [2, 500]
    ])
    const kill = out.events[0]
    expect(kill.type === 'CHAMPION_KILL' && [kill.killerId, kill.victimId, kill.assisting]).toEqual(
      [2, 1, [1]]
    )
    expect(kill.type === 'CHAMPION_KILL' && kill.damageReceived[0].participantId).toBe(2)
    expect(out.events[1].type === 'WARD_PLACED' && out.events[1].creatorId).toBe(1)
  })

  it('should map unknown puuid to 0 and drop its frames', () => {
    const out = remapTimeline(tl, new Map([['a', 1]]))
    expect(out.frames[0].players.map(p => p.participantId)).toEqual([1])
    expect(out.events[0].type === 'CHAMPION_KILL' && out.events[0].victimId).toBe(0)
  })
})

describe('buildPuuidMap', () => {
  it('should read puuids from gameDetail identities by index', () => {
    const game = {
      participantIdentities: [{ player: { puuid: 'me' } }],
      gameDetail: {
        participantIdentities: [{ player: { puuid: 'x' } }, { player: { puuid: 'me' } }]
      }
    } as unknown as Game
    expect([...buildPuuidMap(game)]).toEqual([
      ['x', 1],
      ['me', 2]
    ])
  })
})

describe('puuid 防合并（空 / 重复 puuid 不得把两名玩家并成一人）', () => {
  const identities = (puuids: string[]) =>
    ({
      participantIdentities: puuids.map(puuid => ({ player: { puuid } }))
    }) as unknown as Game

  it('buildPuuidMap ignores empty puuids and drops duplicated ones', () => {
    const m = buildPuuidMap(identities(['a', '', 'dup', 'dup', 'e']))
    expect([...m.entries()]).toEqual([
      ['a', 1],
      ['e', 5]
    ])
  })

  it('remapTimeline maps DETAILS participants with empty/duplicate puuid to 0', () => {
    const t: SlimTimeline = {
      ...tl,
      participants: [
        { participantId: 1, puuid: '' },
        { participantId: 2, puuid: 'b' },
        { participantId: 3, puuid: 'x' },
        { participantId: 4, puuid: 'x' }
      ]
    }
    // 名册里 '' 与 'x' 都"能对上"——但空/重复 puuid 不可信，必须记 0
    const map = new Map([
      ['', 7],
      ['b', 2],
      ['x', 3]
    ])
    const out = remapTimeline(t, map)
    expect(out.participants.map(p => p.participantId)).toEqual([0, 2, 0, 0])
    const kill = out.events[0]
    expect(kill.type === 'CHAMPION_KILL' && [kill.killerId, kill.victimId]).toEqual([0, 2])
  })
})
