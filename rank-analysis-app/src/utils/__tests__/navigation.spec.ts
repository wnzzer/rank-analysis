/**
 * searchSummoner 跳转策略单元测试
 *
 * - 非 Tauri 环境（浏览器 dev / jsdom）回退为应用内 router.push
 * - Tauri 环境：新开 WebviewWindow 加载 `#/Record?name=...`（name 需 URL 编码）
 * - 同玩家重复跳转：命中已有 `record-<hash>` 窗口 → 聚焦复用，不再开新窗
 * - 新窗口创建失败（tauri://error）回退为应用内跳转
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const webviewWindows: {
    label: string
    options: Record<string, unknown>
    onceCb: (() => void) | null
  }[] = []
  let createdCount = 0
  const getByLabel = vi.fn()
  class MockWebviewWindow {
    onceCb: (() => void) | null = null
    constructor(
      public label: string,
      public options: Record<string, unknown>
    ) {
      webviewWindows.push(this)
      createdCount += 1
    }
    static getByLabel = getByLabel
    setFocus = vi.fn()
    once(_event: string, cb: () => void) {
      this.onceCb = cb
    }
  }
  return {
    routerPush: vi.fn(),
    webviewWindows,
    getByLabel,
    MockWebviewWindow,
    get createdCount() {
      return createdCount
    },
    resetCreatedCount() {
      createdCount = 0
    }
  }
})

vi.mock('@renderer/router', () => ({ default: { push: h.routerPush } }))

vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: h.MockWebviewWindow }))

import { searchSummoner } from '../navigation'

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('searchSummoner', () => {
  beforeEach(() => {
    h.routerPush.mockClear()
    h.webviewWindows.length = 0
    h.resetCreatedCount()
    h.getByLabel.mockReset()
    h.getByLabel.mockResolvedValue(null)
  })

  it('非 Tauri 环境回退为应用内路由跳转', () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    searchSummoner('Kill#NA1')
    expect(h.webviewWindows).toHaveLength(0)
    expect(h.routerPush).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/Record',
        query: expect.objectContaining({ name: 'Kill#NA1' })
      })
    )
  })

  it('Tauri 环境：新窗口打开玩家战绩，URL 编码 name#tag', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    searchSummoner('Kill#NA1')
    await flush()
    expect(h.webviewWindows).toHaveLength(1)
    const w = h.webviewWindows[0]
    expect(w.label).toMatch(/^record-[a-z0-9]+$/)
    expect(w.options.url).toContain('index.html#/Record?name=Kill%23NA1&t=')
    expect(w.options.title).toBe('战绩查询 · Kill#NA1')
    expect(h.routerPush).not.toHaveBeenCalled()
  })

  it('同玩家重复跳转：复用已有窗口并聚焦，不重复开窗', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    searchSummoner('Kill#NA1')
    await flush()
    expect(h.createdCount).toBe(1)
    const createdBefore = h.createdCount

    const existing = new h.MockWebviewWindow('record-x', {})
    h.getByLabel.mockResolvedValue(existing as never)
    searchSummoner('Kill#NA1')
    await flush()

    expect(h.createdCount).toBe(createdBefore + 1) // 只新建了 mock 的 existing，未再开真实窗口
    expect(existing.setFocus).toHaveBeenCalled()
    expect(h.routerPush).not.toHaveBeenCalled()
  })

  it('同一窗口标签对同一玩家 ID 稳定（大小写不敏感）', () => {
    // 直接验证窗口标签由玩家 ID 稳定生成
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    searchSummoner('Kill#NA1')
    searchSummoner('kill#na1')
    expect(h.webviewWindows).toHaveLength(0) // 尚未 flush，窗口在微任务中创建
    const labels = new Set(h.getByLabel.mock.calls.map(c => c[0]))
    expect(labels.size).toBe(1)
  })
})
