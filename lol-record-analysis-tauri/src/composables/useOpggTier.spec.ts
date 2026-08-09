import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import { opggRevision } from '@renderer/services/opgg'
import { useOpggTier } from './useOpggTier'

const mockGet = vi.mocked(getConfigByIpc)
const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)

describe('useOpggTier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    opggRevision.value = 0
  })

  it('loadTier 读配置；缺失时落到默认段位', async () => {
    mockGet.mockResolvedValueOnce('diamond_plus')
    const a = useOpggTier()
    await a.loadTier()
    expect(mockGet).toHaveBeenCalledWith('settings.opgg.tier')
    expect(a.tier.value).toBe('diamond_plus')

    mockGet.mockResolvedValueOnce(undefined)
    const b = useOpggTier()
    await b.loadTier()
    expect(b.tier.value).toBe('emerald_plus')
  })

  it('切换成功：写配置、强制重拉 ranked、bump 一次版本号', async () => {
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    mockPut.mockResolvedValueOnce(undefined)
    mockInvoke.mockResolvedValueOnce({ mode: 'ranked', patch: '16.13' })

    const ok = await t.switchTier('master_plus')

    expect(ok).toBe(true)
    expect(mockPut).toHaveBeenCalledWith('settings.opgg.tier', 'master_plus')
    expect(mockInvoke).toHaveBeenCalledWith('update_opgg_data', { mode: 'ranked' })
    expect(t.tier.value).toBe('master_plus')
    expect(opggRevision.value).toBe(1)
    expect(t.loading.value).toBe(false)
  })

  it('重拉失败：tier 回滚到切换前，不 bump——界面不能承诺没拿到的数据', async () => {
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    mockPut.mockResolvedValueOnce(undefined)
    mockInvoke.mockRejectedValueOnce('network down')

    const ok = await t.switchTier('gold_plus')

    expect(ok).toBe(false)
    expect(t.tier.value).toBe('emerald_plus')
    expect(opggRevision.value).toBe(0)
    expect(t.loading.value).toBe(false)
  })

  it('切换期间 loading 为 true，结束后复位', async () => {
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    let seenDuringInvoke = false
    mockPut.mockResolvedValueOnce(undefined)
    mockInvoke.mockImplementationOnce(async () => {
      seenDuringInvoke = t.loading.value
      return {}
    })

    await t.switchTier('diamond_plus')
    expect(seenDuringInvoke).toBe(true)
    expect(t.loading.value).toBe(false)
  })

  it('切到当前段位是 no-op，不写配置也不重拉', async () => {
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    const ok = await t.switchTier('emerald_plus')

    expect(ok).toBe(true)
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(opggRevision.value).toBe(0)
  })
})
