/**
 * 对局详情独立窗口的生命周期
 *
 * 打开链路：隐藏创建（visible:false + 主题底色）→ 详情页内容就绪后自行 show 并广播
 * 就绪事件 → 主窗口据此结束卡片「打开中」态；3s 未就绪由主窗口强制 show 兜底。
 * 实测此前窗口一创建就可见：先白底、再按默认暗色画一帧、再切主题/缩放，跳变 4 次。
 *
 * @module components/record/detailWindow
 */
import { ref } from 'vue'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { emit, listen } from '@tauri-apps/api/event'
import type { Game } from './match'

/** 详情窗 label 前缀；capability `match-detail-*` 与各处「是否详情窗」判断都依赖它 */
export const MATCH_DETAIL_LABEL_PREFIX = 'match-detail-'
/** 详情窗内容就绪、已自行 show 后广播的事件（payload: { label }） */
export const MATCH_DETAIL_READY_EVENT = 'match-detail-ready'
/** 就绪兜底：详情窗 3s 内未自报就绪则由主窗口强制 show，保证窗口不会丢 */
export const READY_FALLBACK_MS = 3000

/** 当前 webview 是否为独立对局详情窗 */
export function isMatchDetailWindow(): boolean {
  return getCurrentWindow().label.startsWith(MATCH_DETAIL_LABEL_PREFIX)
}

function getMatchDetailWindowLabel(game: Game) {
  return `${MATCH_DETAIL_LABEL_PREFIX}${game.gameId}`
}

function getMatchDetailStorageKey(game: Game) {
  return `match-detail:${game.gameId}`
}

function buildMatchDetailUrl() {
  return `${window.location.origin}/#/MatchDetail`
}

function persistMatchDetail(storageKey: string, game: Game) {
  localStorage.setItem(storageKey, JSON.stringify(game))
}

/** 宽屏下的理想尺寸（内容按 1280 设计宽等比缩放，见 composables/useDetailZoom.ts）。 */
const PREFERRED_SIZE = { width: 1300, height: 900 }
/**
 * 尺寸下限：宽 1040 ≈ 0.8（DETAIL_FIT_MIN）× 1280 设计宽 + 边距，最小窗口里也不出横向滚动；
 * 仅在工作区放得下时才生效（fitToWorkArea）。
 */
const FLOOR_SIZE = { width: 1040, height: 560 }
/** 与屏幕边缘留出的余量（左右/上下合计）。 */
const WORK_AREA_MARGIN = 40

/**
 * 按显示器工作区约束详情窗口尺寸。
 *
 * **为什么必须约束**：该窗口是 `decorations: false`，没有原生标题栏，唯一的拖动区
 * 是页面内那条 28px 自定义标题栏（`MatchDetail.vue` 的 `.match-detail-window-bar`），
 * 而「关闭」按钮也在其中。一旦窗口高过工作区，`center: true` 会把窗口顶部推出屏幕
 * 上沿——标题栏连同关闭按钮一起不可见、不可点，又因为没有原生标题栏而无法把窗口
 * 拖回来，直接形成死锁（只能靠 Cmd+W / Alt+F4 逃生）。
 *
 * 实测触发：macOS 1440×900（扣菜单栏与 Dock 后可用高 783）、Windows 1366×768
 * （扣任务栏后约 728），都小于期望高度 900。
 */
function fitToWorkArea() {
  const width = Math.min(PREFERRED_SIZE.width, window.screen.availWidth - WORK_AREA_MARGIN)
  const height = Math.min(PREFERRED_SIZE.height, window.screen.availHeight - WORK_AREA_MARGIN)
  return {
    width,
    height,
    // 下限不得超过实际尺寸，否则用户无法把窗口缩小自救
    minWidth: Math.min(FLOOR_SIZE.width, width),
    minHeight: Math.min(FLOOR_SIZE.height, height)
  }
}

/**
 * 当前主题底色，作为新窗口的原生背景色——隐藏创建到首帧之间任何情况都不露白。
 *
 * `theme-light` 类挂在 n-config-provider 根上而非 documentElement（见 App.vue），
 * 直接读 :root 的 --bg-base 在亮色下会拿到暗色值，所以从该元素读。
 */
function currentThemeBackground(): string {
  const host = document.querySelector('.n-config-provider') ?? document.documentElement
  const value = getComputedStyle(host).getPropertyValue('--bg-base').trim()
  return value || '#0d0d0f'
}

/** 同一局的并发打开复用同一个进行中的 Promise（快速双击不会 new 两个同 label 窗口而报错） */
const inflight = new Map<string, Promise<void>>()

/**
 * 打开（或聚焦已有的）对局详情窗
 *
 * 窗口隐藏创建，由详情页在内容就绪后自行 show（{@link revealCurrentDetailWindow}）。
 * @param game - 要展示的对局（经 localStorage 交给新窗口）
 * @returns 窗口已显示时 resolve（就绪事件或 3s 兜底），调用方据此结束「打开中」态
 */
export function openMatchDetailWindow(game: Game): Promise<void> {
  const label = getMatchDetailWindowLabel(game)
  const running = inflight.get(label)
  if (running) return running
  const task = openOrFocus(game, label).finally(() => inflight.delete(label))
  inflight.set(label, task)
  return task
}

async function openOrFocus(game: Game, label: string): Promise<void> {
  persistMatchDetail(getMatchDetailStorageKey(game), game)

  const existingWindow = await WebviewWindow.getByLabel(label)
  if (existingWindow) {
    await existingWindow.show()
    await existingWindow.setFocus()
    return
  }

  let markShown: () => void = () => {}
  const shown = new Promise<void>(resolve => {
    markShown = resolve
  })
  // 先挂监听再建窗：详情窗可能在 new 返回前就已就绪
  const unlisten = await listen<{ label: string }>(MATCH_DETAIL_READY_EVENT, event => {
    if (event.payload.label === label) markShown()
  })

  const detailWindow = new WebviewWindow(label, {
    title: '对局详情',
    url: buildMatchDetailUrl(),
    ...fitToWorkArea(),
    center: true,
    resizable: true,
    focus: true,
    visible: false,
    backgroundColor: currentThemeBackground(),
    decorations: false,
    transparent: false,
    shadow: true
  })

  detailWindow.once('tauri://error', error => {
    console.error('Failed to create match detail window:', error)
    markShown()
  })

  const fallback = setTimeout(() => {
    void forceShow(detailWindow).finally(markShown)
  }, READY_FALLBACK_MS)

  try {
    await shown
  } finally {
    clearTimeout(fallback)
    unlisten()
  }
}

/** 兜底：详情页未能自报就绪（脚本异常等）时由主窗口把它亮出来 */
async function forceShow(win: WebviewWindow): Promise<void> {
  try {
    if (await win.isVisible()) return
    console.warn(`[detailWindow] ${win.label} not ready after ${READY_FALLBACK_MS}ms, forcing show`)
    await win.show()
    await win.setFocus()
  } catch (e) {
    console.warn('[detailWindow] fallback show failed:', e)
  }
}

/**
 * 详情页内容就绪后调用：亮出并聚焦本窗口，再广播就绪事件（主窗口据此结束「打开中」态）
 */
export async function revealCurrentDetailWindow(): Promise<void> {
  const win = getCurrentWindow()
  try {
    await win.show()
    await win.setFocus()
  } finally {
    await emit(MATCH_DETAIL_READY_EVENT, { label: win.label })
  }
}

/**
 * 战绩卡「打开中」态：同一局打开中重复点击忽略，窗口显示（或兜底）后复位
 *
 * MatchHistory / AiSearchResults 共用；isOpening 供 RecordCard 的 opening prop。
 */
export function useDetailOpener() {
  const opening = ref(new Set<number>())

  async function open(game: Game): Promise<void> {
    if (opening.value.has(game.gameId)) return
    opening.value.add(game.gameId)
    try {
      await openMatchDetailWindow(game)
    } catch (e) {
      console.error('[detailWindow] open failed:', e)
    } finally {
      opening.value.delete(game.gameId)
    }
  }

  return { isOpening: (gameId: number) => opening.value.has(gameId), open }
}
