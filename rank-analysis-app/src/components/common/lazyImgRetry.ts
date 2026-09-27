/**
 * LazyImg 的失败重试策略
 *
 * 图标走 `asset://` 协议，后端在资源列表还没就绪（冷启动 / 客户端刚连上 / 离线兜底
 * 还在拉）时会回 404。协议响应带 no-store，失败不会被负缓存，但 `<img>` 自己不会
 * 再请求——不重试的话这张图会一直裂到组件被重新挂载。
 */

/**
 * 每次重试前的等待时长（毫秒），长度即最大重试次数
 *
 * 递增间隔覆盖后端的几个恢复时机：LCU 连上后的刷新（5s 间隔）与离线 init 冷却（30s）。
 */
export const LAZY_IMG_RETRY_DELAYS_MS = [3_000, 10_000, 35_000] as const

/**
 * 给图片地址加上重试参数，绕开 webview 对同一 URL 的复用
 * @param src - 原始地址
 * @param attempt - 第几次重试（0 表示原始请求，原样返回）
 * @returns 带 `retry` 参数的地址
 * @example
 * ```ts
 * withRetryParam('asset://localhost/item/3145', 1) // 'asset://localhost/item/3145?retry=1'
 * ```
 */
export function withRetryParam(src: string, attempt: number): string {
  if (attempt <= 0 || !src) return src
  return `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`
}
