import { invoke } from '@tauri-apps/api/core'

// Public assets prefix (no trailing slash to avoid double slashes)
//
// Tauri 自定义协议 `asset` 在不同平台的访问格式不同，不能硬编码单一份：
//   - Windows（WebView2）  ：http://asset.localhost
//   - macOS / Linux        ：asset://localhost
// 由后端命令 `get_asset_prefix` 返回，应用启动时经 initAssetPrefix() 初始化；
// 纯前端开发 / 单测等非 Tauri 环境回退到 Windows 默认格式。
export let assetPrefix = `http://asset.localhost`

// Base URL for the local HTTP server
const baseURL = ``

export { baseURL }

/**
 * 初始化 asset 协议 URL 前缀（在 app.mount 之前调用一次）。
 *
 * 必须在任何依赖 assetPrefix 的图片渲染前完成；invoke 失败时保持默认值并告警，
 * 不影响非图片功能。
 */
export async function initAssetPrefix(): Promise<void> {
  try {
    assetPrefix = await invoke<string>('get_asset_prefix')
  } catch (e) {
    // 回退默认值（Windows 格式）；非 Tauri 环境仅影响图片源，不阻断启动
    console.warn('[asset] 获取 asset 前缀失败，回退默认值:', e)
  }
}
