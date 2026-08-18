import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import { getRankByPuuid, getRanksByPuuids, clearRankCache } from '../rank'
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

describe('rank service: getRankByPuuid caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRankCache()
  })

  it('empty puuid returns null without invoking', async () => {
    expect(await getRankByPuuid('')).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('caches successful result and does not re-request on the next call', async () => {
    mockInvoke.mockResolvedValueOnce(makeRank('DIAMOND'))

    const first = await getRankByPuuid('puuid-1')
    const second = await getRankByPuuid('puuid-1')

    expect(first?.queueMap.RANKED_SOLO_5x5.tier).toBe('DIAMOND')
    expect(second).toBe(first)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('get_rank_by_puuid', { puuid: 'puuid-1' })
  })

  it('dedupes concurrent requests for the same puuid into a single invoke call', async () => {
    let resolveInvoke: (value: Rank) => void = () => {}
    mockInvoke.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveInvoke = resolve
        })
    )

    const call1 = getRankByPuuid('puuid-2')
    const call2 = getRankByPuuid('puuid-2')

    resolveInvoke(makeRank('GOLD'))
    const [result1, result2] = await Promise.all([call1, call2])

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(result1?.queueMap.RANKED_SOLO_5x5.tier).toBe('GOLD')
    expect(result2).toBe(result1)
  })

  it('does not cache a failed request, so the next call retries', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('LCU not running'))

    const first = await getRankByPuuid('puuid-3')
    expect(first).toBeNull()
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    mockInvoke.mockResolvedValueOnce(makeRank('SILVER'))
    const second = await getRankByPuuid('puuid-3')

    expect(second?.queueMap.RANKED_SOLO_5x5.tier).toBe('SILVER')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('returns null instead of throwing when invoke rejects', async () => {
    mockInvoke.mockRejectedValueOnce('boom')
    await expect(getRankByPuuid('puuid-4')).resolves.toBeNull()
  })

  it('different puuids are cached independently', async () => {
    mockInvoke.mockResolvedValueOnce(makeRank('BRONZE')).mockResolvedValueOnce(makeRank('PLATINUM'))

    const a = await getRankByPuuid('puuid-a')
    const b = await getRankByPuuid('puuid-b')

    expect(a?.queueMap.RANKED_SOLO_5x5.tier).toBe('BRONZE')
    expect(b?.queueMap.RANKED_SOLO_5x5.tier).toBe('PLATINUM')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })
})

describe('rank service: getRanksByPuuids batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRankCache()
  })

  it('fetches missing puuids in a single batch invoke, returning per-player results', async () => {
    mockInvoke.mockResolvedValue({ p1: makeRank('GOLD'), p2: null })

    const out = await getRanksByPuuids(['p1', 'p2'])

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('get_ranks_by_puuids', { puuids: ['p1', 'p2'] })
    expect(out.p1?.queueMap.RANKED_SOLO_5x5.tier).toBe('GOLD')
    expect(out.p2).toBeNull()
  })

  it('filters empty puuids and dedupes duplicates before invoking', async () => {
    mockInvoke.mockResolvedValue({ p1: makeRank('GOLD') })

    const out = await getRanksByPuuids(['p1', 'p1', '', 'p1'])

    expect(mockInvoke).toHaveBeenCalledWith('get_ranks_by_puuids', { puuids: ['p1'] })
    expect(out.p1?.queueMap.RANKED_SOLO_5x5.tier).toBe('GOLD')
  })

  it('serves already-cached puuids without invoking again and merges with fresh ones', async () => {
    mockInvoke.mockResolvedValueOnce(makeRank('DIAMOND'))
    await getRankByPuuid('cached-1')

    mockInvoke.mockResolvedValue({ fresh: makeRank('PLATINUM') })
    const out = await getRanksByPuuids(['cached-1', 'fresh'])

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenCalledWith('get_ranks_by_puuids', { puuids: ['fresh'] })
    expect(out['cached-1']?.queueMap.RANKED_SOLO_5x5.tier).toBe('DIAMOND')
    expect(out.fresh?.queueMap.RANKED_SOLO_5x5.tier).toBe('PLATINUM')
  })

  it('throws on a whole-batch failure and leaves nothing cached for retry', async () => {
    mockInvoke.mockRejectedValue(new Error('LCU offline'))

    await expect(getRanksByPuuids(['p1'])).rejects.toThrow('LCU offline')

    // 失败不写缓存：下一次调用会重新发起请求
    mockInvoke.mockResolvedValue({ p1: makeRank('SILVER') })
    const out = await getRanksByPuuids(['p1'])
    expect(out.p1?.queueMap.RANKED_SOLO_5x5.tier).toBe('SILVER')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('caches successful batch results, so later single lookups skip IPC', async () => {
    mockInvoke.mockResolvedValue({ p1: makeRank('GOLD') })

    const batch = await getRanksByPuuids(['p1'])
    expect(batch.p1?.queueMap.RANKED_SOLO_5x5.tier).toBe('GOLD')

    const single = await getRankByPuuid('p1')
    expect(single?.queueMap.RANKED_SOLO_5x5.tier).toBe('GOLD')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })
})
