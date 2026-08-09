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

  it('loadTier 读到不在白名单内的非法值（配置被外部改坏）时落到默认段位，而非无校验强转', async () => {
    // 修复 D：旧版本遗留值 / 手改配置文件都可能写进一个不在 TIER_OPTIONS 里的字符串。
    // Rust 侧 sanitize_tier 会静默回落默认段位再请求数据；前端若不校验直接
    // `as OpggTier`，下拉会显示一个 naive-ui 找不到匹配选项的非法值（渲染成空白），
    // 界面显示的段位与实际请求数据用的段位就对不上——与段位切换失败判定同一类
    // 「界面撒谎」。
    mockGet.mockResolvedValueOnce('legendary_plus')
    const t = useOpggTier()
    await t.loadTier()
    expect(t.tier.value).toBe('emerald_plus')
  })

  it('切换成功：写配置、强制重拉 ranked、bump 一次版本号', async () => {
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    mockPut.mockResolvedValueOnce(undefined)
    mockInvoke.mockResolvedValueOnce({ mode: 'ranked', patch: '16.13', tier: 'master_plus' })

    const ok = await t.switchTier('master_plus')

    expect(ok).toBe(true)
    expect(mockPut).toHaveBeenCalledWith('settings.opgg.tier', 'master_plus')
    expect(mockInvoke).toHaveBeenCalledWith('update_opgg_data', { mode: 'ranked' })
    // 动作顺序是规格点名的要求：写配置必须先于强制重拉，
    // 否则重拉用的还是切换前的段位配置。用 invocationCallOrder 钉住先后。
    expect(mockPut.mock.invocationCallOrder[0]).toBeLessThan(mockInvoke.mock.invocationCallOrder[0])
    expect(t.tier.value).toBe('master_plus')
    expect(opggRevision.value).toBe(1)
    expect(t.loading.value).toBe(false)
  })

  it('invoke 正常 resolve 但返回的是旧段位快照（降级链兜底）：tier 回滚、不 bump、返回 false', async () => {
    // 修复 B 的核心证据：src-tauri/src/command/opgg.rs 的降级链在 HTTP 拉取失败但
    // 内存/磁盘仍有缓存时，会 `Ok` 返回那份旧段位数据（不是 Err）。国服网络不稳时
    // 这比「invoke 直接抛错」常见得多——如果只认 invoke 是否 resolve，就会出现下拉
    // 停在新段位、卡片却还是旧段位数据的「说的是钻石、显示的是翡翠」状态。
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    mockPut.mockResolvedValueOnce(undefined)
    // invoke 正常 resolve（不抛错），但 status.tier 仍是切换前的 emerald_plus——
    // 后端把过期的旧段位缓存当降级结果返回了。
    mockInvoke.mockResolvedValueOnce({
      mode: 'ranked',
      patch: '16.13',
      fetchedAt: Date.now(),
      stale: true,
      championCount: 120,
      tier: 'emerald_plus'
    })

    const ok = await t.switchTier('gold_plus')

    expect(ok).toBe(false)
    expect(t.tier.value).toBe('emerald_plus')
    expect(opggRevision.value).toBe(0)
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

  it('写配置失败：tier 回滚到切换前，不再往下重拉，不 bump', async () => {
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    mockPut.mockRejectedValueOnce(new Error('disk full'))

    const ok = await t.switchTier('gold_plus')

    expect(ok).toBe(false)
    expect(t.tier.value).toBe('emerald_plus')
    expect(opggRevision.value).toBe(0)
    expect(t.loading.value).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('切换期间 loading 为 true，结束后复位', async () => {
    mockGet.mockResolvedValueOnce('emerald_plus')
    const t = useOpggTier()
    await t.loadTier()

    let seenDuringInvoke = false
    mockPut.mockResolvedValueOnce(undefined)
    mockInvoke.mockImplementationOnce(async () => {
      seenDuringInvoke = t.loading.value
      return { tier: 'diamond_plus' }
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
