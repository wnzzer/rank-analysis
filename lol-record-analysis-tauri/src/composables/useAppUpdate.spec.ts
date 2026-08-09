/**
 * useAppUpdate 单元测试
 *
 * 覆盖两个关键点：
 * 1. manual/silent 两种模式在「无更新」「查询失败」上的用户反馈必须不同——
 *    manual 是用户主动点的，必须给通知；silent 是后台自发的，必须安静。
 * 2. checking/availableUpdate 是模块级单例：任意两处调用 useAppUpdate() 都要
 *    看到同一份状态，否则关于页手动查到新版本、顶栏药丸感知不到（见
 *    useAppUpdate.ts 顶部关于 singleton 的说明）。
 *
 * @module composables/useAppUpdate
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Update } from '@tauri-apps/plugin-updater'

const dialogInfo = vi.fn()
const notificationInfo = vi.fn()
const notificationError = vi.fn()

vi.mock('naive-ui', () => ({
  useDialog: () => ({ info: dialogInfo }),
  useNotification: () => ({ info: notificationInfo, error: notificationError }),
  NProgress: {}
}))

const mockCheck = vi.fn()
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args)
}))

const mockRelaunch = vi.fn()
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: (...args: unknown[]) => mockRelaunch(...args)
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn()
}))

// 每个用例都要拿到全新的模块实例，否则模块级单例状态会跨用例串扰
async function importFresh() {
  vi.resetModules()
  return await import('./useAppUpdate')
}

/** 测试只用得到 version/body/downloadAndInstall，其余 Update/Resource 字段用类型断言略过 */
function makeUpdate(overrides: Partial<{ version: string; body: string }> = {}): Update {
  return {
    version: overrides.version ?? '1.2.3',
    date: '2026-08-09',
    body: overrides.body ?? '- 修了个 bug',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined)
  } as unknown as Update
}

describe('useAppUpdate', () => {
  beforeEach(() => {
    dialogInfo.mockReset()
    notificationInfo.mockReset()
    notificationError.mockReset()
    mockCheck.mockReset()
    mockRelaunch.mockReset()
  })

  it('manual 模式查到更新：设置 availableUpdate 并弹出确认框，不弹"没有更新"通知', async () => {
    const { useAppUpdate } = await importFresh()
    const update = makeUpdate()
    mockCheck.mockResolvedValue(update)

    const { checkForUpdates, availableUpdate } = useAppUpdate()
    const result = await checkForUpdates('manual')

    expect(result).toBe(update)
    expect(availableUpdate.value).toBe(update)
    expect(dialogInfo).toHaveBeenCalledTimes(1)
    expect(dialogInfo.mock.calls[0][0].title).toBe('发现新版本')
    expect(notificationInfo).not.toHaveBeenCalled()
    expect(notificationError).not.toHaveBeenCalled()
  })

  it('manual 模式没有更新：弹"没有更新"通知反馈，用户主动点的不能没反馈', async () => {
    const { useAppUpdate } = await importFresh()
    mockCheck.mockResolvedValue(null)

    const { checkForUpdates, availableUpdate } = useAppUpdate()
    const result = await checkForUpdates('manual')

    expect(result).toBeNull()
    expect(availableUpdate.value).toBeNull()
    expect(notificationInfo).toHaveBeenCalledTimes(1)
    expect(notificationInfo.mock.calls[0][0].title).toBe('没有更新')
    expect(dialogInfo).not.toHaveBeenCalled()
  })

  it('manual 模式查询失败：弹错误通知', async () => {
    const { useAppUpdate } = await importFresh()
    mockCheck.mockRejectedValue(new Error('network down'))

    const { checkForUpdates } = useAppUpdate()
    const result = await checkForUpdates('manual')

    expect(result).toBeNull()
    expect(notificationError).toHaveBeenCalledTimes(1)
    expect(notificationError.mock.calls[0][0].title).toBe('更新检查失败')
  })

  it('silent 模式没有更新：不打扰 UI，不弹任何通知/对话框', async () => {
    const { useAppUpdate } = await importFresh()
    mockCheck.mockResolvedValue(null)

    const { checkForUpdates } = useAppUpdate()
    const result = await checkForUpdates('silent')

    expect(result).toBeNull()
    expect(notificationInfo).not.toHaveBeenCalled()
    expect(notificationError).not.toHaveBeenCalled()
    expect(dialogInfo).not.toHaveBeenCalled()
  })

  it('silent 模式查询失败：静默处理，不弹错误通知（后台自发探测，失败弹框纯属打扰）', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { useAppUpdate } = await importFresh()
    mockCheck.mockRejectedValue(new Error('timeout'))

    const { checkForUpdates } = useAppUpdate()
    const result = await checkForUpdates('silent')

    expect(result).toBeNull()
    expect(notificationError).not.toHaveBeenCalled()
    expect(notificationInfo).not.toHaveBeenCalled()
    expect(dialogInfo).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('silent 模式查到更新：设置 availableUpdate 但不弹确认框（顶栏药丸由 availableUpdate 驱动，不是弹窗）', async () => {
    const { useAppUpdate } = await importFresh()
    const update = makeUpdate({ version: '9.9.9' })
    mockCheck.mockResolvedValue(update)

    const { checkForUpdates, availableUpdate } = useAppUpdate()
    await checkForUpdates('silent')

    expect(availableUpdate.value).toBe(update)
    expect(dialogInfo).not.toHaveBeenCalled()
    expect(notificationInfo).not.toHaveBeenCalled()
  })

  it('状态是模块级单例：两处调用共享同一份 availableUpdate（关于页手动查到，顶栏药丸也要感知到）', async () => {
    const { useAppUpdate } = await importFresh()
    const update = makeUpdate({ version: '2.0.0' })
    mockCheck.mockResolvedValue(update)

    // 模拟 About.vue 与 Header.vue 各自独立调用 useAppUpdate()
    const aboutInstance = useAppUpdate()
    const headerInstance = useAppUpdate()

    await aboutInstance.checkForUpdates('manual')

    expect(aboutInstance.availableUpdate.value).toBe(update)
    expect(headerInstance.availableUpdate.value).toBe(update)
  })

  it('showUpdateDialog 点击"立即更新"成功后 relaunch', async () => {
    const { useAppUpdate } = await importFresh()
    const update = makeUpdate()

    const { showUpdateDialog } = useAppUpdate()
    showUpdateDialog(update)

    expect(dialogInfo).toHaveBeenCalledTimes(1)
    const onPositiveClick = dialogInfo.mock.calls[0][0].onPositiveClick as () => Promise<void>
    dialogInfo.mockClear()
    dialogInfo.mockReturnValue({ destroy: vi.fn() })

    await onPositiveClick()

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(mockRelaunch).toHaveBeenCalledTimes(1)
  })

  it('下载安装失败：销毁进度弹窗并弹错误通知，不静默吞掉（用户已明确点了更新）', async () => {
    const { useAppUpdate } = await importFresh()
    const update = makeUpdate()
    vi.mocked(update.downloadAndInstall).mockRejectedValue(new Error('disk full'))
    const destroy = vi.fn()
    dialogInfo.mockReturnValue({ destroy })

    const { showUpdateDialog } = useAppUpdate()
    showUpdateDialog(update)
    const onPositiveClick = dialogInfo.mock.calls[0][0].onPositiveClick as () => Promise<void>

    await onPositiveClick()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(notificationError).toHaveBeenCalledTimes(1)
    expect(notificationError.mock.calls[0][0].title).toBe('更新失败')
    expect(mockRelaunch).not.toHaveBeenCalled()
  })
})
