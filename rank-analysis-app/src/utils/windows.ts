/**
 * 多窗口（新标签页）工具：战绩子窗口判定、窗口去重、窗口切换/关闭、并排分屏。
 *
 * 约定：主窗口标签恒为 `main`；点击玩家 ID 打开的「战绩子窗口」标签为 `record-<hash>`，
 * capabilities 里用 `record-*` 通配给子窗口放行核心权限（见
 * `src-tauri/capabilities/default.json`）。
 */

import {
  WebviewWindow,
  getCurrentWebviewWindow,
  getAllWebviewWindows
} from '@tauri-apps/api/webviewWindow'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'

/** 战绩子窗口标签前缀 */
export const RECORD_WINDOW_PREFIX = 'record-'

/**
 * 由玩家 ID 生成稳定的子窗口标签（同一玩家永远同标签 → 重复点击聚焦复用而非再开一窗）。
 * 标签须为 `a-zA-Z-/:_` 子集：取 nameId 小写后的 31 进制 hash，转 36 进制。
 */
export function recordWindowLabel(nameId: string): string {
  let hash = 0
  const s = nameId.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0
  }
  return `${RECORD_WINDOW_PREFIX}${Math.abs(hash).toString(36)}`
}

function hasTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 当前窗口标签；非 Tauri 环境（浏览器 dev / 单测 jsdom）返回 null */
export function currentWindowLabel(): string | null {
  if (!hasTauri()) return null
  try {
    return getCurrentWebviewWindow().label
  } catch {
    return null
  }
}

/** 当前是否为战绩子窗口（record-*） */
export function isRecordChildWindow(): boolean {
  const label = currentWindowLabel()
  return !!label && label.startsWith(RECORD_WINDOW_PREFIX)
}

/** 按标签聚焦窗口 */
export async function focusWindowByLabel(label: string): Promise<void> {
  const win = await WebviewWindow.getByLabel(label)
  if (win) await win.setFocus()
}

/** 聚焦主窗口 */
export async function focusMainWindow(): Promise<void> {
  await focusWindowByLabel('main')
}

/** 当前应用全部窗口标签：主窗口在前，战绩子窗口按标签升序 */
async function orderedWindowLabels(): Promise<string[]> {
  const all = await getAllWebviewWindows()
  const main = all.filter(w => w.label === 'main').map(w => w.label)
  const children = all
    .filter(w => w.label.startsWith(RECORD_WINDOW_PREFIX))
    .map(w => w.label)
    .sort()
  return [...main, ...children]
}

/** Ctrl+Tab：循环聚焦下一个窗口（主窗口参与循环，滚动回环） */
export async function cycleWindows(): Promise<void> {
  const labels = await orderedWindowLabels()
  if (labels.length < 2) return
  const current = currentWindowLabel()
  const idx = Math.max(0, labels.indexOf(current ?? ''))
  const next = labels[(idx + 1) % labels.length]
  await focusWindowByLabel(next)
}

/** Ctrl+W：仅关闭战绩子窗口（主窗口不响应，避免误关整应用） */
export async function closeCurrentRecordWindow(): Promise<void> {
  if (!isRecordChildWindow()) return
  try {
    await getCurrentWebviewWindow().close()
  } catch (e) {
    console.warn('close record window failed:', e)
  }
}

/**
 * 并排分屏：把主窗口 + 全部战绩子窗口横向铺满「当前窗口」所在的屏幕区域，
 * 等宽排列，全部置前。窗口数少于 2 时无操作。
 */
export async function tileWindowsSideBySide(): Promise<void> {
  const labels = await orderedWindowLabels()
  if (labels.length < 2) return
  const current = getCurrentWebviewWindow()
  const pos = await current.outerPosition()
  const size = await current.outerSize()
  const count = labels.length
  const gap = 4
  const winWidth = Math.max(600, Math.floor((size.width - gap * (count - 1)) / count))
  for (let i = 0; i < labels.length; i++) {
    const win = await WebviewWindow.getByLabel(labels[i])
    if (!win) continue
    await win.setSize(new LogicalSize(winWidth, size.height))
    await win.setPosition(new LogicalPosition(pos.x + i * (winWidth + gap), pos.y))
    await win.show()
  }
  await focusWindowByLabel(labels[0])
}
