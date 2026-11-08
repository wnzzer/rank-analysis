/**
 * TS 版时间线裁剪与 Rust slim_from_raw 对拍：同一份匿名 DETAILS（src-tauri/tests/fixtures）
 * 经 Rust dump_slim_fixtures（ANON=1、无物品表）的输出即为期望值。
 */
import { describe, it, expect } from 'vitest'
import raw from '../../../src-tauri/tests/fixtures/sgp_details_sample.json'
import expected from './fixtures/sgp_details_sample.slim.json'
import { slimFromDetails, type RawDetailsJson } from '../slim'

describe('slimFromDetails', () => {
  it('matches the Rust slimmer field by field', () => {
    const out = slimFromDetails((raw as unknown as { json: RawDetailsJson }).json)
    expect(out).toEqual(expected)
  })

  it('aggregates damage per source, ties on slot pick the larger slot (Rust max_by_key)', () => {
    const out = slimFromDetails({
      gameId: 1,
      frameInterval: 60000,
      participants: [],
      frames: [
        {
          timestamp: 0,
          participantFrames: {},
          events: [
            {
              type: 'CHAMPION_KILL',
              timestamp: 5,
              killerId: 2,
              victimId: 1,
              victimDamageReceived: [
                { participantId: 2, physicalDamage: 100, spellSlot: 0 },
                { participantId: 2, magicDamage: 100, spellSlot: 3 },
                { participantId: 3, trueDamage: 300, spellSlot: 1 },
                { participantId: -1, physicalDamage: 999, spellSlot: 0 }
              ]
            }
          ]
        }
      ]
    })
    const kill = out.events[0]
    expect(kill.type).toBe('CHAMPION_KILL')
    if (kill.type === 'CHAMPION_KILL') {
      expect(kill.damageReceived).toEqual([
        { participantId: 3, total: 300, topSlot: 1 },
        { participantId: 2, total: 200, topSlot: 3 }
      ])
      expect(kill.assisting).toEqual([])
      expect([kill.x, kill.y]).toEqual([0, 0])
    }
  })

  it('drops noise events and sorts events by timestamp stably across frames', () => {
    const out = slimFromDetails({
      frames: [
        {
          timestamp: 0,
          events: [
            { type: 'ITEM_DESTROYED', timestamp: 1 },
            { type: 'WARD_PLACED', timestamp: 9, creatorId: 1, wardType: 'CONTROL_WARD' }
          ]
        },
        { timestamp: 60000, events: [{ type: 'GAME_END', timestamp: 3, winningTeam: 100 }] }
      ]
    })
    expect(out.events.map(e => e.type)).toEqual(['GAME_END', 'WARD_PLACED'])
    expect(out.items).toEqual({})
    expect(out.frames.map(f => f.timestamp)).toEqual([0, 60000])
  })
})
