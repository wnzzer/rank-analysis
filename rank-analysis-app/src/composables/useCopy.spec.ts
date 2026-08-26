/**
 * useCopy 单元测试：剪贴板写入结果映射为成功/失败提示（R29-2）。
 * naive-ui 的 useMessage 经 mock 注入，避免依赖 MessageProvider 上下文。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('naive-ui', () => ({
  useMessage: () => messageMock
}))

import { useCopy } from './useCopy'

describe('useCopy', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator as object, 'clipboard')
  })

  /** copy 内部 promise 链经模块转换后第 3 个微任务才落地（实测，见 R29 计划备注） */
  async function flush(): Promise<void> {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }

  it('shows success toast when clipboard write resolves', async () => {
    writeText.mockResolvedValue(undefined)
    const { copy } = useCopy()
    copy('玩家#520')
    await flush()
    expect(writeText).toHaveBeenCalledWith('玩家#520')
    expect(messageMock.success).toHaveBeenCalledWith('复制成功')
    expect(messageMock.error).not.toHaveBeenCalled()
  })

  it('shows error toast when clipboard write rejects', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const { copy } = useCopy()
    copy('玩家#520')
    await flush()
    expect(messageMock.error).toHaveBeenCalledWith('复制失败')
    expect(messageMock.success).not.toHaveBeenCalled()
  })
})
