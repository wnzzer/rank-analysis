/**
 * detailWindow.ts · 详情窗打开链路测试
 *
 * 守护：隐藏创建 + 主题底色、就绪握手、3s 兜底、同局并发只建一个窗口、打开中态。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Game } from '../match'

type FakeWin = {
  label: string
  options: Record<string, unknown>
  show: ReturnType<typeof vi.fn>
  setFocus: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
}

const h = vi.hoisted(() => ({
  created: [] as FakeWin[],
  readyListeners: [] as Array<(event: { payload: { label: string } }) => void>,
  getByLabel: vi.fn(async (): Promise<unknown> => null),
  emit: vi.fn(async () => {}),
  current: { label: 'main' },
  currentShow: vi.fn(async () => {}),
  currentFocus: vi.fn(async () => {})
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    static getByLabel = h.getByLabel
    label: string
    options: Record<string, unknown>
    show = vi.fn(async () => {})
    setFocus = vi.fn(async () => {})
    isVisible = vi.fn(async () => false)
    once = vi.fn()
    constructor(label: string, options: Record<string, unknown>) {
      this.label = label
      this.options = options
      h.created.push(this as unknown as FakeWin)
    }
  }
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, cb: (event: { payload: { label: string } }) => void) => {
    h.readyListeners.push(cb)
    return () => h.readyListeners.splice(h.readyListeners.indexOf(cb), 1)
  }),
  emit: h.emit
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: h.current.label,
    show: h.currentShow,
    setFocus: h.currentFocus
  })
}))

import {
  openMatchDetailWindow,
  revealCurrentDetailWindow,
  isMatchDetailWindow,
  useDetailOpener,
  MATCH_DETAIL_READY_EVENT,
  READY_FALLBACK_MS
} from '../detailWindow'

const game = (gameId: number) => ({ gameId }) as unknown as Game
/** 模拟详情窗自报就绪 */
function fireReady(label: string) {
  for (const cb of [...h.readyListeners]) cb({ payload: { label } })
}
/** 推进假时钟 0ms 以冲刷 getByLabel/listen 等 Promise 链 */
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('openMatchDetailWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.created.length = 0
    h.readyListeners.length = 0
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should create the window hidden with a theme background', async () => {
    const opened = openMatchDetailWindow(game(42))
    await settle()
    expect(h.created).toHaveLength(1)
    expect(h.created[0].label).toBe('match-detail-42')
    expect(h.created[0].options).toMatchObject({
      visible: false,
      backgroundColor: expect.any(String)
    })
    fireReady('match-detail-42')
    await expect(opened).resolves.toBeUndefined()
  })

  it('should not force show once the detail page reported ready', async () => {
    const opened = openMatchDetailWindow(game(43))
    await settle()
    fireReady('match-detail-43')
    await opened
    await vi.advanceTimersByTimeAsync(READY_FALLBACK_MS)
    expect(h.created[0].show).not.toHaveBeenCalled()
  })

  it('should ignore ready events of other windows', async () => {
    const opened = openMatchDetailWindow(game(44))
    let done = false
    void opened.then(() => (done = true))
    await settle()
    fireReady('match-detail-999')
    await settle()
    expect(done).toBe(false)
    fireReady('match-detail-44')
    await opened
  })

  it('should force show after the fallback timeout when never ready', async () => {
    const opened = openMatchDetailWindow(game(45))
    await settle()
    await vi.advanceTimersByTimeAsync(READY_FALLBACK_MS)
    await opened
    expect(h.created[0].show).toHaveBeenCalledTimes(1)
    expect(h.created[0].setFocus).toHaveBeenCalledTimes(1)
  })

  it('should reuse the in-flight open for rapid double clicks', async () => {
    const first = openMatchDetailWindow(game(46))
    const second = openMatchDetailWindow(game(46))
    expect(second).toBe(first)
    await settle()
    expect(h.created).toHaveLength(1)
    fireReady('match-detail-46')
    await first
  })

  it('should focus an existing window instead of creating a new one', async () => {
    const existing = { show: vi.fn(async () => {}), setFocus: vi.fn(async () => {}) }
    h.getByLabel.mockResolvedValueOnce(existing)
    await openMatchDetailWindow(game(47))
    expect(existing.show).toHaveBeenCalled()
    expect(existing.setFocus).toHaveBeenCalled()
    expect(h.created).toHaveLength(0)
  })
})

describe('revealCurrentDetailWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show, focus, then broadcast ready with its own label', async () => {
    h.current.label = 'match-detail-48'
    await revealCurrentDetailWindow()
    expect(h.currentShow).toHaveBeenCalledTimes(1)
    expect(h.currentFocus).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith(MATCH_DETAIL_READY_EVENT, { label: 'match-detail-48' })
  })
})

describe('isMatchDetailWindow', () => {
  it('should detect windows by the label prefix', () => {
    h.current.label = 'match-detail-1'
    expect(isMatchDetailWindow()).toBe(true)
    h.current.label = 'main'
    expect(isMatchDetailWindow()).toBe(false)
  })
})

describe('useDetailOpener', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.created.length = 0
    h.readyListeners.length = 0
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should mark the game opening until shown and ignore repeated clicks', async () => {
    const { isOpening, open } = useDetailOpener()
    const opened = open(game(49))
    expect(isOpening(49)).toBe(true)
    void open(game(49))
    await settle()
    expect(h.created).toHaveLength(1)
    fireReady('match-detail-49')
    await opened
    expect(isOpening(49)).toBe(false)
  })
})
