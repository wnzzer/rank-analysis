import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { dataPatch, aiCacheGet, aiCachePut } from '../cache'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {}
}))

let invokeMock: Mock

beforeEach(async () => {
  const core = await import('@tauri-apps/api/core')
  invokeMock = core.invoke as unknown as Mock
  invokeMock.mockReset()
  sessionStorage.clear()
})

describe('dataPatch', () => {
  it('取版本前两段作为 patch 分片', () => {
    expect(dataPatch('25.6.1.123')).toBe('25.6')
    expect(dataPatch('16.13.5')).toBe('16.13')
  })

  it('无版本段时原样返回', () => {
    expect(dataPatch('25')).toBe('25')
  })

  it('缺版本给 unknown', () => {
    expect(dataPatch(undefined)).toBe('unknown')
    expect(dataPatch('')).toBe('unknown')
  })
})

describe('aiCacheGet', () => {
  it('磁盘命中时直接返回 invoke 结果（不读 sessionStorage）', async () => {
    sessionStorage.setItem('k', 'session-value')
    invokeMock.mockResolvedValue('disk-value')

    expect(await aiCacheGet('k', '25.6')).toBe('disk-value')
    expect(invokeMock).toHaveBeenCalledWith('ai_cache_get', { key: 'k', patch: '25.6' })
  })

  it('invoke 返回 null（未命中）时回退 sessionStorage', async () => {
    sessionStorage.setItem('k', 'session-value')
    invokeMock.mockResolvedValue(null)

    expect(await aiCacheGet('k', '25.6')).toBe('session-value')
  })

  it('invoke 失败（IPC 不可用）时回退 sessionStorage', async () => {
    sessionStorage.setItem('k', 'session-value')
    invokeMock.mockRejectedValue(new Error('no tauri'))

    expect(await aiCacheGet('k')).toBe('session-value')
  })

  it('双缓存都为空时返回 null', async () => {
    invokeMock.mockResolvedValue(null)
    expect(await aiCacheGet('k')).toBeNull()
  })
})

describe('aiCachePut', () => {
  it('走磁盘时把 key/patch/value 传给 ai_cache_put', async () => {
    invokeMock.mockResolvedValue(undefined)
    await aiCachePut('k', '25.6', 'v')
    expect(invokeMock).toHaveBeenCalledWith('ai_cache_put', { key: 'k', patch: '25.6', value: 'v' })
  })

  it('invoke 失败时降级写入 sessionStorage', async () => {
    invokeMock.mockRejectedValue(new Error('no tauri'))
    await aiCachePut('k', '25.6', 'v')
    expect(sessionStorage.getItem('k')).toBe('v')
  })
})
