/**
 * 应用挂载前后的窗口生命周期步骤（每个 WebviewWindow 都会执行 main.ts）
 *
 * 首帧必须已是最终态：主题与主窗口缩放都在 mount 前就位。实测此前主题在 mount 后
 * 异步读取、缩放在 onMounted 里补应用，详情窗会先按默认暗色 / 1 倍画一帧再跳变。
 *
 * @module boot
 */
import type { Pinia } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { initAssetPrefix } from './services/http'
import { initPlatform, initInstallForm } from './services/platform'
import { useSettingsStore } from './pinia/setting'
import { applySavedWindowZoom } from './composables/useZoom'
import { isMatchDetailWindow } from './components/record/detailWindow'

/**
 * mount 前的准备：平台三项 + 主题 + 主窗口缩放，互不依赖、全部并发
 * @param pinia - 尚未 install 到 app 的 pinia 实例（store 需显式传入）
 */
export async function prepareBoot(pinia: Pinia): Promise<void> {
  await Promise.all([
    // asset 协议前缀（图片 src）、平台标识（Windows 专属入口）、安装形态（更新通道）
    initAssetPrefix(),
    initPlatform(),
    initInstallForm(),
    useSettingsStore(pinia).initTheme(),
    // 详情窗缩放由 useDetailZoom 以 CSS zoom 管理，webview 缩放保持 1
    isMatchDetailWindow() ? Promise.resolve() : applySavedWindowZoom()
  ])
}

/**
 * 亮出主窗口（tauri.conf.json 里 visible:false 隐藏启动）
 *
 * 调用方只等 mount + nextTick，不等 requestAnimationFrame：隐藏的 WebView 可能暂停
 * rAF，等它会退化成只能靠 Rust 端 3s 兜底才出现。失败不抛错，同样由 Rust 兜底。
 */
export async function revealMainWindow(): Promise<void> {
  try {
    await getCurrentWindow().show()
  } catch (e) {
    console.warn('show main window failed:', e)
  }
}
