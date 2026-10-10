/**
 * useLolAutostartGuard 单元测试
 *
 * 覆盖：挂载时补查残留并提示、事件触发提示且每次运行至多一次、残留消失时收起、
 * 一键关闭成功/取消 UAC/失败三种反馈、非 Windows 不提示。
 *
 * @module composables/useLolAutostartGuard
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { withSetup } from '@renderer/test-utils/withSetup'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

const eventHandlers: Record<string, (e: { payload: unknown }) => void> = {}
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    eventHandlers[name] = cb
    return () => delete eventHandlers[name]
  })
}))

const destroyMock = vi.fn()
const warningMock = vi.fn(() => ({ destroy: destroyMock }))
const successMock = vi.fn()
const errorMock = vi.fn()
vi.mock('naive-ui', async importOriginal => ({
  ...(await importOriginal<typeof import('naive-ui')>()),
  useNotification: () => ({ warning: warningMock }),
  useMessage: () => ({ success: successMock, error: errorMock })
}))

let windows = true
vi.mock('@renderer/services/platform', () => ({ isWindows: () => windows }))

import { useLolAutostartGuard, AUTOSTART_BLOCKED_EVENT } from './useLolAutostartGuard'

async function flush() {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
}

/** 取出通知里「一键关闭」按钮的点击回调 */
function clickPurge(): Promise<void> {
  const opts = (
    warningMock.mock.calls.at(-1) as unknown as [
      { action: () => { props: { onClick: () => Promise<void> } } }
    ]
  )[0]
  return opts.action().props.onClick()
}

function mount(blocked: boolean) {
  invokeMock.mockImplementation(async (cmd: string) =>
    cmd === 'get_lol_autostart_blocked' ? blocked : undefined
  )
  return withSetup(() => useLolAutostartGuard())
}

describe('useLolAutostartGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windows = true
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k]
  })

  it('should prompt on mount when backend already reports blocked', async () => {
    mount(true)
    await flush()
    expect(warningMock).toHaveBeenCalledTimes(1)
  })

  it('should prompt at most once per run even if event fires again', async () => {
    mount(false)
    await flush()
    expect(warningMock).not.toHaveBeenCalled()

    eventHandlers[AUTOSTART_BLOCKED_EVENT]({ payload: true })
    eventHandlers[AUTOSTART_BLOCKED_EVENT]({ payload: true })
    expect(warningMock).toHaveBeenCalledTimes(1)
  })

  it('should close the prompt when the entry disappears', async () => {
    mount(true)
    await flush()
    eventHandlers[AUTOSTART_BLOCKED_EVENT]({ payload: false })
    expect(destroyMock).toHaveBeenCalled()
  })

  it('should report success after elevated purge', async () => {
    mount(true)
    await flush()
    await clickPurge()
    expect(invokeMock).toHaveBeenCalledWith('purge_lol_autostart_elevated')
    expect(successMock).toHaveBeenCalled()
    expect(destroyMock).toHaveBeenCalled()
  })

  it('should stay silent when user cancels UAC', async () => {
    mount(true)
    await flush()
    invokeMock.mockRejectedValueOnce('已取消管理员授权。')
    await clickPurge()
    expect(errorMock).not.toHaveBeenCalled()
    expect(destroyMock).not.toHaveBeenCalled()
  })

  it('should show error when purge fails', async () => {
    mount(true)
    await flush()
    invokeMock.mockRejectedValueOnce('清理未完成，请稍后重试。')
    await clickPurge()
    expect(errorMock).toHaveBeenCalledWith('清理未完成，请稍后重试。')
  })

  it('should do nothing on non-Windows', async () => {
    windows = false
    mount(true)
    await flush()
    expect(warningMock).not.toHaveBeenCalled()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
