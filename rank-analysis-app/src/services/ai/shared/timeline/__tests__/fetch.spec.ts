import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
const getConfigMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }))
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: (...a: unknown[]) => getConfigMock(...a)
}))

import { clearTimelineMemo, fetchMatchTimeline, supportsTimeline } from '../fetch'
import type { Game } from '@renderer/types/domain/match'

const game = {
  gameId: 7,
  platformId: 'TJ100',
  participantIdentities: [],
  gameDetail: { participantIdentities: [{ player: { puuid: 'p1' } }] }
} as unknown as Game
const slim = {
  gameId: 7,
  frameIntervalMs: 60000,
  participants: [{ participantId: 1, puuid: 'p1' }],
  frames: [],
  events: [],
  items: {}
}

describe('fetchMatchTimeline', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    getConfigMock.mockReset()
    clearTimelineMemo()
  })

  it('should return ok with remapped timeline', async () => {
    getConfigMock.mockResolvedValue(null)
    invokeMock.mockResolvedValue(slim)
    const r = await fetchMatchTimeline(game)
    expect(invokeMock).toHaveBeenCalledWith('get_match_timeline', {
      platformId: 'TJ100',
      gameId: 7
    })
    expect(r.status).toBe('ok')
    expect(r.timeline?.participants).toEqual([{ participantId: 1, puuid: 'p1' }])
  })

  it('should be disabled when switch is off', async () => {
    getConfigMock.mockResolvedValue(false)
    const r = await fetchMatchTimeline(game)
    expect(r).toEqual({ timeline: null, status: 'disabled' })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('should degrade to unavailable on invoke error', async () => {
    getConfigMock.mockResolvedValue(true)
    invokeMock.mockRejectedValue('SGP 非 2xx（404）')
    const r = await fetchMatchTimeline(game)
    expect(r).toEqual({ timeline: null, status: 'unavailable' })
  })

  it('should memoize per gameId so a second call does not invoke again', async () => {
    getConfigMock.mockResolvedValue(true)
    invokeMock.mockResolvedValue(slim)
    const a = await fetchMatchTimeline(game)
    const b = await fetchMatchTimeline(game)
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(b).toEqual(a)
    await fetchMatchTimeline({ ...game, gameId: 8 } as Game)
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('should share one in-flight request between concurrent calls', async () => {
    getConfigMock.mockResolvedValue(true)
    invokeMock.mockResolvedValue(slim)
    await Promise.all([fetchMatchTimeline(game), fetchMatchTimeline(game)])
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('should memoize failures too (tab switches do not refetch a slow/broken SGP)', async () => {
    getConfigMock.mockResolvedValue(true)
    invokeMock.mockRejectedValue('timeout')
    expect((await fetchMatchTimeline(game)).status).toBe('unavailable')
    expect((await fetchMatchTimeline(game)).status).toBe('unavailable')
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('should not memoize disabled (switch may be flipped back on)', async () => {
    getConfigMock.mockResolvedValueOnce(false).mockResolvedValue(true)
    invokeMock.mockResolvedValue(slim)
    expect((await fetchMatchTimeline(game)).status).toBe('disabled')
    expect((await fetchMatchTimeline(game)).status).toBe('ok')
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})

describe('supportsTimeline', () => {
  it.each([
    [11, true],
    [12, true],
    [30, false],
    [21, false]
  ])('mapId %i → %s', (mapId, expected) => {
    expect(supportsTimeline({ mapId } as Game)).toBe(expected)
  })
})
