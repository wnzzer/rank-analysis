import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { Game } from './match'

function getMatchDetailWindowLabel(game: Game) {
  return `match-detail-${game.gameId}`
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

/** 宽屏下的理想尺寸（版心上限 1360，见 MatchDetail.vue）。 */
const PREFERRED_SIZE = { width: 1300, height: 900 }
/** 尺寸下限——再小表格会挤成一团；仅在工作区放得下时才生效。 */
const FLOOR_SIZE = { width: 900, height: 560 }
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

export async function openMatchDetailWindow(game: Game) {
  const windowLabel = getMatchDetailWindowLabel(game)
  const storageKey = getMatchDetailStorageKey(game)

  persistMatchDetail(storageKey, game)

  const existingWindow = await WebviewWindow.getByLabel(windowLabel)
  if (existingWindow) {
    await existingWindow.show()
    await existingWindow.setFocus()
    return
  }

  const detailWindow = new WebviewWindow(windowLabel, {
    title: '对局详情',
    url: buildMatchDetailUrl(),
    ...fitToWorkArea(),
    center: true,
    resizable: true,
    focus: true,
    decorations: false,
    transparent: false,
    shadow: true
  })

  detailWindow.once('tauri://created', async () => {
    await detailWindow.setFocus()
  })

  detailWindow.once('tauri://error', error => {
    console.error('Failed to create match detail window:', error)
  })
}
