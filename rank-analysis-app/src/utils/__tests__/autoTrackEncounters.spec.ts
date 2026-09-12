/**
 * autoTrackEncounters 单元测试
 * @module utils/autoTrackEncounters
 */
import { describe, it, expect, vi } from 'vitest'
import { autoTrackEncounters } from '../autoTrackEncounters'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import type { PlayerNote } from '@renderer/types/domain/playerNote'

/** 构造一条最小可用的同场对局记录 */
function makeGame(gameId: number, puuid: string): OneGamePlayer {
  return {
    gameCreatedAt: '2026-05-20T10:00:00Z',
    index: 0,
    gameId,
    puuid,
    gameName: 'G',
    tagLine: 'T',
    championId: 1,
    win: true,
    kills: 1,
    deaths: 2,
    assists: 3,
    isMyTeam: false,
    queueIdCn: '极地大乱斗'
  }
}

/** 构造一条最小可用的已保存备注（用于 getNote 命中） */
function makeNote(): PlayerNote {
  return { note: '', label: 'normal', gameName: 'G', tagLine: 'T', updatedAt: 1 }
}

describe('autoTrackEncounters', () => {
  it('map 为 null 时安全跳过，不调用 recordEncounters', () => {
    const getNote = vi.fn()
    const recordEncounters = vi.fn()
    autoTrackEncounters(null, getNote, recordEncounters)
    expect(recordEncounters).not.toHaveBeenCalled()
  })

  it('只对已有备注的 puuid 调用 recordEncounters，其余跳过', () => {
    const map = {
      noted: [makeGame(1, 'noted')],
      stranger: [makeGame(2, 'stranger')]
    }
    const getNote = vi.fn((puuid: string) => (puuid === 'noted' ? makeNote() : undefined))
    const recordEncounters = vi.fn()

    autoTrackEncounters(map, getNote, recordEncounters)

    expect(recordEncounters).toHaveBeenCalledTimes(1)
    expect(recordEncounters).toHaveBeenCalledWith('noted', map.noted)
  })

  it('recordEncounters 拒绝（reject）不会向上抛出', () => {
    const map = { noted: [makeGame(1, 'noted')] }
    const getNote = vi.fn(() => makeNote())
    const recordEncounters = vi.fn(() => Promise.reject(new Error('落盘失败')))

    expect(() => autoTrackEncounters(map, getNote, recordEncounters)).not.toThrow()
  })
})
