/**
 * 战报图的导出与打点：DOM → PNG → 系统剪贴板，玩家在 QQ / 微信里直接粘贴。
 *
 * - 截图用 modern-screenshot（克隆节点渲染到 canvas）；图标先转 data URL 再渲染，
 *   不依赖截图库自己跨源取图（asset 协议与页面不同源）。
 * - 剪贴板走 Tauri 插件 writeImage（WebView 的 navigator.clipboard 在 mac WKWebView 上对图片不可靠）。
 * - 打点只发白名单动作名，后端映射成静态功能名（见 match_label.rs::track_share_card）。
 */
import { invoke } from '@tauri-apps/api/core'
import { writeImage } from '@tauri-apps/plugin-clipboard-manager'
import { domToBlob } from 'modern-screenshot'

/** 导出倍率：卡片按 360×480 CSS 像素排版，×3 得 1080×1440（3:4，群聊 / 朋友圈都不裁） */
export const SHARE_CARD_SCALE = 3

/**
 * 写剪贴板的尝试次数与间隔。
 *
 * Windows 的剪贴板是全系统共用的一把锁：剪贴板历史、输入法、远程桌面、各种剪贴板工具
 * 都会在内容变化的瞬间去读它。真机上（2026-11-21）偶发
 * 「SetClipboardData failed … 线程没有打开的剪贴板 (os error 1418)」，紧接着再点一次就成功。
 * 这类失败是瞬时的，隔一小会儿重试即可，不该让玩家自己再点。
 */
export const CLIPBOARD_ATTEMPTS = 4
export const CLIPBOARD_RETRY_MS = 150

/** 战报图打点动作 */
export type ShareCardAction = 'shown' | 'copied' | 'angle' | 'self_roast'

/** 打点；上报关闭或非 Tauri 环境时静默失败 */
export function trackShareCard(action: ShareCardAction): void {
  invoke('track_share_card', { action }).catch(() => {
    // 打点失败不影响功能
  })
}

/**
 * 把图片 URL 读成 data URL，供卡片内嵌（导出时不再跨源取图）
 * @returns 失败返回 null（卡片不画头像）
 */
export async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * 把卡片节点渲染成 PNG 写入剪贴板
 * @param el - 卡片根节点（固定尺寸，不受外层缩放影响）
 * @throws 渲染或写剪贴板失败时抛出，由调用方提示
 */
export async function copyCardImage(el: HTMLElement): Promise<void> {
  const blob = await domToBlob(el, { scale: SHARE_CARD_SCALE, type: 'image/png' })
  await writeImageWithRetry(new Uint8Array(await blob.arrayBuffer()))
}

/**
 * 把 PNG 写入剪贴板，瞬时失败时自动重试
 * @param png - PNG 文件内容
 * @throws 连续 {@link CLIPBOARD_ATTEMPTS} 次都失败时抛出最后一次的错误
 */
export async function writeImageWithRetry(png: Uint8Array): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < CLIPBOARD_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, CLIPBOARD_RETRY_MS))
    try {
      await writeImage(png)
      return
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}
