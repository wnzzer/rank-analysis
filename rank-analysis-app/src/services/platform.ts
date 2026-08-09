/**
 * 平台标识（用于前端能力门控）
 *
 * 部分能力只在 Windows 存在——免 WeGame 一键启动（`launch_league`）、以管理员身份
 * 重启（`relaunch_as_admin`）——在 macOS / Linux 上后端会直接返回错误。前端据此隐藏
 * 相应入口，避免渲染出「点了必失败」的死按钮。
 *
 * 由后端命令 `get_platform` 返回（`std::env::consts::OS`），应用启动时经
 * {@link initPlatform} 初始化；非 Tauri 环境（纯前端开发 / 单测）回退 `windows`，
 * 与既有行为保持一致。
 */
import { invoke } from '@tauri-apps/api/core'

/** 当前操作系统标识：`windows` / `macos` / `linux` 等。 */
export let platformOs = 'windows'

/** 当前是否为 Windows。 */
export function isWindows(): boolean {
  return platformOs === 'windows'
}

/**
 * 初始化平台标识（在 `app.mount` 之前调用一次）。
 *
 * invoke 失败时保持默认值并告警，不阻断启动。
 */
export async function initPlatform(): Promise<void> {
  try {
    platformOs = await invoke<string>('get_platform')
  } catch (e) {
    console.warn('[platform] 获取平台标识失败，回退默认值:', e)
  }
}
