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
 *
 * 本模块同时承载**安装形态**（{@link installForm}）：便携版必须走自研自更新，走官方
 * updater 会把新版装到标准安装目录、原地的便携 exe 一字未动（详见后端
 * `command/portable_update.rs` 的模块说明）。
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

/**
 * 当前安装形态：`installer`（安装器安装）/ `portable`（免安装裸 exe）/ `macos_bundle`。
 *
 * 默认值刻意取 `installer` —— 探测失败时退回官方 updater（即现有行为）是安全的；
 * 反过来把安装版误判成便携版，会让它去做原地替换 exe 这种有副作用的操作。
 */
export let installForm = 'installer'

/** 当前是否为便携版（免安装裸 exe，只可能出现在 Windows）。 */
export function isPortable(): boolean {
  return installForm === 'portable'
}

/**
 * 初始化安装形态（在 `app.mount` 之前调用一次）。
 *
 * invoke 失败时保持默认值并告警，不阻断启动。
 */
export async function initInstallForm(): Promise<void> {
  try {
    installForm = await invoke<string>('get_install_form')
  } catch (e) {
    console.warn('[platform] 获取安装形态失败，回退默认值:', e)
  }
}
