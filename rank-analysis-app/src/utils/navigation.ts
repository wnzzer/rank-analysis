/**
 * 路由跳转快捷方法
 *
 * 点击玩家 ID 跳转战绩：默认在**新窗口**（Tauri WebviewWindow）打开该玩家战绩页，
 * 原窗口保持不变 —— 桌面版「新标签页」，可同时对比多位玩家。
 * - 窗口标签 `record-<hash>`（由玩家 ID 稳定生成）需命中 capabilities 的
 *   `record-*` 通配（见 `src-tauri/capabilities/default.json`），新窗口才能使用
 *   IPC 等核心权限。
 * - 同玩家重复点击：命中已存在的 `record-<hash>` 窗口则**聚焦复用**，不重复开窗。
 * - 非 Tauri 环境（浏览器 dev / 单测 jsdom）回退为当前窗口内路由跳转。
 * - 窗口创建失败（tauri://error，如权限缺失/标签冲突）回退为应用内跳转。
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import router from '@renderer/router'
import { recordWindowLabel } from '@renderer/utils/windows'

export function searchSummoner(nameId: string) {
  const goInApp = () =>
    router.push({
      path: '/Record',
      query: { name: nameId, t: Date.now() }
    })

  const hasTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!hasTauri) {
    goInApp()
    return
  }

  const label = recordWindowLabel(nameId)

  // 同玩家窗口已存在 → 聚焦复用，不再开新窗
  void WebviewWindow.getByLabel(label).then(existing => {
    if (existing) {
      void existing.setFocus()
      return
    }
    openRecordWindow(label, nameId, goInApp)
  })
}

function openRecordWindow(label: string, nameId: string, onError: () => void) {
  const webview = new WebviewWindow(label, {
    url: `index.html#/Record?name=${encodeURIComponent(nameId)}&t=${Date.now()}`,
    title: `战绩查询 · ${nameId}`,
    width: 1200,
    height: 800,
    resizable: true,
    decorations: false,
    transparent: true,
    backgroundColor: '#0d0d0f',
    center: true,
    theme: 'dark',
    dragDropEnabled: false
  })
  webview.once('tauri://error', onError)
}
