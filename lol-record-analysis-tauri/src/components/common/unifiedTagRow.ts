/**
 * UnifiedTagRow 的纯函数逻辑:标签排序与溢出切片
 *
 * 抽离为独立模块以便单测(同 championIntel.ts 旁置模式)。
 * @module components/common/unifiedTagRow
 */
import type { RankTag } from '@renderer/types/domain/analysis'

/**
 * 系统标签排序:bad(警示)在前,good 在后;同组保持后端原序
 * @param tags - 后端计算的标签列表
 * @returns 新数组,不修改入参
 */
export function orderTags(tags: RankTag[]): RankTag[] {
  return [...tags].sort((a, b) => Number(a.good) - Number(b.good))
}

/**
 * 按可见上限切片
 * @param tags - 已排序标签
 * @param maxVisible - 最多可见数;undefined 表示不限
 * @returns visible 直接渲染,overflow 收进 +N popover
 */
export function splitVisible(
  tags: RankTag[],
  maxVisible?: number
): { visible: RankTag[]; overflow: RankTag[] } {
  if (maxVisible === undefined || tags.length <= maxVisible) {
    return { visible: tags, overflow: [] }
  }
  return { visible: tags.slice(0, maxVisible), overflow: tags.slice(maxVisible) }
}
