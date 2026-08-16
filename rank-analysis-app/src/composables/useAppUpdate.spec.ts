/**
 * useAppUpdate 行为测试：manual/silent 差异、更新检测开关闸门、单例状态
 *
 * Header.updatePill.spec.ts 头部注释声明过本文件的存在（原为遗留占位），
 * 现补齐实现：开关（silent 拦截）与 manual/silent 反馈差异是本 file 专注点。
 *
 * @module composables/useAppUpdate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Update } from '@tauri-apps/plugin-updater'

const mockCheck = vi.fn()
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args)
}))

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

const mockDialog = { info: vi.fn() }
const mockNotification = { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return {
    ...actual,
    useDialog: () => mockDialog,
    useNotification: () => mockNotification
  }
})

const mockGetConfigByIpc = vi.fn()
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: (...args: unknown[]) => mockGetConfigByIpc(...args)
}))

import { useAppUpdate } from './useAppUpdate'

function asUpdate(overrides: Partial<Update> = {}): Update {
  return { version: '9.9.9', body: '测试更新内容', ...overrides } as Update
}

describe('useAppUpdate 更新检测开关', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheck.mockResolvedValue(null)
    mockGetConfigByIpc.mockResolvedValue(true)
  })

  it('静默模式 + 开关关闭：直接返回 null，不发起查询', async () => {
    mockGetConfigByIpc.mockResolvedValue(false)
    const { checkForUpdates } = useAppUpdate()

    const result = await checkForUpdates('silent')

    expect(result).toBeNull()
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('静默模式 + 开关开启：发起查询', async () => {
    mockGetConfigByIpc.mockResolvedValue(true)
    const { checkForUpdates } = useAppUpdate()

    await checkForUpdates('silent')

    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('静默模式 + 开关读取失败：按默认开处理，照常发起查询', async () => {
    mockGetConfigByIpc.mockRejectedValue(new Error('config 不可用'))
    const { checkForUpdates } = useAppUpdate()

    await checkForUpdates('silent')

    expect(mockCheck).toHaveBeenCalledTimes(1)
  })

  it('手动模式 + 开关关闭：不受开关限制，仍发起查询', async () => {
    mockGetConfigByIpc.mockResolvedValue(false)
    const { checkForUpdates } = useAppUpdate()

    await checkForUpdates('manual')

    expect(mockCheck).toHaveBeenCalledTimes(1)
  })
})

describe('useAppUpdate manual / silent 反馈差异', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheck.mockResolvedValue(null)
    mockGetConfigByIpc.mockResolvedValue(true)
  })

  it('手动模式无更新：弹「没有更新」通知', async () => {
    const { checkForUpdates } = useAppUpdate()
    await checkForUpdates('manual')
    expect(mockNotification.info).toHaveBeenCalledWith(
      expect.objectContaining({ title: '没有更新' })
    )
  })

  it('静默模式无更新：不弹通知（安静处理）', async () => {
    const { checkForUpdates } = useAppUpdate()
    await checkForUpdates('silent')
    expect(mockNotification.info).not.toHaveBeenCalled()
  })

  it('手动模式发现更新：记录并弹「发现新版本」对话框', async () => {
    mockCheck.mockResolvedValue(asUpdate())
    const { checkForUpdates, availableUpdate } = useAppUpdate()

    const update = await checkForUpdates('manual')

    expect(update).not.toBeNull()
    expect(availableUpdate.value).toEqual(expect.objectContaining({ version: '9.9.9' }))
    expect(mockDialog.info).toHaveBeenCalledWith(expect.objectContaining({ title: '发现新版本' }))
  })

  it('静默模式发现更新：仅记录 availableUpdate，不弹对话框（药丸出现由 Header 展示）', async () => {
    mockCheck.mockResolvedValue(asUpdate())
    const { checkForUpdates } = useAppUpdate()

    await checkForUpdates('silent')

    expect(mockDialog.info).not.toHaveBeenCalled()
  })

  it('查询失败：manual 弹错误通知，silent 只 console 不留 UI', async () => {
    mockCheck.mockRejectedValue(new Error('network down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkForUpdates } = useAppUpdate()

    await checkForUpdates('manual')
    expect(mockNotification.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: '更新检查失败' })
    )
    vi.clearAllMocks()

    await checkForUpdates('silent')
    expect(mockNotification.error).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
