/**
 * getGameById 局级缓存单元测试
 *
 * - 相同 gameId 只走一次 IPC，重复调用命中缓存
 * - IPC 失败返回 null（不抛异常），且不落缓存（下次重试）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))

import { getGameById, clearGameByIdCache } from '../gameById'

describe('getGameById', () => {
  beforeEach(() => {
    h.invoke.mockReset()
    clearGameByIdCache()
  })

  it('相同 gameId 重复调用只走一次 IPC，命中缓存', async () => {
    const game = { gameId: 123, gameCreationDate: '1700000000000' }
    h.invoke.mockResolvedValue(game)

    const [a, b] = await Promise.all([getGameById(123), getGameById(123)])
    await getGameById(123)

    expect(a).toEqual(game)
    expect(b).toEqual(game)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke).toHaveBeenCalledWith('get_game_by_id', { gameId: 123 })
  })

  it('不同 gameId 各自走 IPC', async () => {
    h.invoke.mockResolvedValue({ gameId: 1 })
    await getGameById(1)
    await getGameById(2)
    expect(h.invoke).toHaveBeenCalledTimes(2)
  })

  it('IPC 失败返回 null 且不抛异常，下次调用重试 IPC', async () => {
    h.invoke.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ gameId: 7 })

    const first = await getGameById(7)
    expect(first).toBeNull()

    const second = await getGameById(7)
    expect(second).toEqual({ gameId: 7 })
    expect(h.invoke).toHaveBeenCalledTimes(2)
  })
})
