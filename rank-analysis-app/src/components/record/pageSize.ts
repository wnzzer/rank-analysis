/**
 * 战绩列表每页条数计算（客户端分页）
 *
 * - `auto`：按窗口可视高度动态计算，让列表尽量铺满视口
 * - `fixed`：使用用户手动设置的固定条数（默认 10，与旧行为一致）
 *
 * @module components/record/pageSize
 */

export type MatchPageMode = 'auto' | 'fixed'

/** fixed 模式默认条数（与旧行为一致：每页 10 条） */
export const DEFAULT_PAGE_SIZE = 10

/** 非列表区域固定占用近似总和（PlayerBar 60 + 工具栏 ~40 + 趋势条 ~40 + 分页 ~48 + 内外边距/间隙 ~76） */
export const PAGE_OVERHEAD_PX = 264
/** 单行占用：RecordCard 44px + 列表 gap 8px */
export const PAGE_ROW_PX = 52
/** auto 模式下条数上下限（对齐 50 场窗口与首屏可读性） */
export const PAGE_SIZE_MIN = 6
export const PAGE_SIZE_MAX = 15

/**
 * 计算每页条数
 *
 * @param viewportHeight - 窗口可视高度（px）
 * @param mode - 模式：auto 动态 / fixed 手动
 * @param fixedSize - fixed 模式下的固定条数（auto 模式下忽略）
 * @returns 每页条数（≥1）
 * @example
 * ```ts
 * computePageSize(800, 'auto', 10) // ~10
 * computePageSize(800, 'fixed', 7) // 7
 * ```
 */
export function computePageSize(
  viewportHeight: number,
  mode: MatchPageMode,
  fixedSize: number
): number {
  if (mode === 'fixed') {
    return Math.max(1, Math.floor(fixedSize))
  }
  const count = Math.floor((viewportHeight - PAGE_OVERHEAD_PX) / PAGE_ROW_PX)
  return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, count))
}
