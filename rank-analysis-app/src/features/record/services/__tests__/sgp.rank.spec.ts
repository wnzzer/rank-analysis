import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import { getSgpRankByName, getSgpRanksByPuuids } from '../sgp'
import type { Rank } from '@renderer/types/domain/player'

const mockInvoke = vi.mocked(invoke)

function makeRank(tier: string): Rank {
  return {
    queueMap: {
      RANKED_SOLO_5x5: {
        queueType: 'RANKED_SOLO_5x5',
        queueTypeCn: '单双排',
        division: 'I',
        tier,
        tierCn: tier,
        highestDivision: 'I',
        highestTier: tier,
        isProvisional: false,
        leaguePoints: 50,
        losses: 10,
        wins: 20
      },
      RANKED_FLEX_SR: {
        queueType: 'RANKED_FLEX_SR',
        queueTypeCn: '灵活组排',
        division: 'NA',
        tier: '',
        tierCn: '',
        highestDivision: 'NA',
        highestTier: '',
        isProvisional: false,
        leaguePoints: 0,
        losses: 0,
        wins: 0
      }
    }
  }
}

describe('sgp rank service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getSgpRankByName invokes the cross-region rank command with region + name#TAG', async () => {
    mockInvoke.mockResolvedValueOnce(makeRank('DIAMOND'))

    const rank = await getSgpRankByName('HN10', '玩家#1234')

    expect(mockInvoke).toHaveBeenCalledWith('get_sgp_rank_by_name', {
      region: 'HN10',
      name: '玩家#1234'
    })
    expect(rank?.queueMap.RANKED_SOLO_5x5.tier).toBe('DIAMOND')
  })

  it('getSgpRankByName degrades to null on failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('SGP 401'))

    expect(await getSgpRankByName('NA1', 'x#000')).toBeNull()
  })

  it('getSgpRanksByPuuids invokes the batch command with deduplicated puuids', async () => {
    mockInvoke.mockResolvedValueOnce({ p1: makeRank('GOLD'), p2: null })

    const out = await getSgpRanksByPuuids('HN10', ['p1', 'p1', 'p2'])

    expect(mockInvoke).toHaveBeenCalledWith('get_sgp_ranks_by_puuids', {
      region: 'HN10',
      puuids: ['p1', 'p2']
    })
    expect(out.p1?.queueMap.RANKED_SOLO_5x5.tier).toBe('GOLD')
    expect(out.p2).toBeNull()
  })

  it('getSgpRanksByPuuids returns empty object without invoking for empty input', async () => {
    const out = await getSgpRanksByPuuids('HN10', ['', ''])

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(out).toEqual({})
  })

  it('getSgpRanksByPuuids propagates whole-batch failure (caller decides degrade)', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('LCU offline'))

    await expect(getSgpRanksByPuuids('HN10', ['p1'])).rejects.toThrow('LCU offline')
  })
})
