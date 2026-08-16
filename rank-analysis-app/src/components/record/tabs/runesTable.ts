/**
 * 详情页「符文」tab 的纯函数层：
 * - DDragon 符文长描述里的 `@eogvarN@` 终局数值占位符 → 对局实际数值（selection.varN）
 *
 * 资源层 `get_asset_details` 已把 perk 长描述归一化为纯文本（HTML 剥除），
 * 占位符原样保留；本层只做占位符替换，可单测。
 */

import type { GamePerkSelection } from '@renderer/types/domain/match'

const EOG_VAR_PATTERN = /@eogvar(\d+)@/g

/**
 * 替换符文描述中的终局数值占位符为对局实际数值。
 * - 无描述 → 返回 ''（调用方不渲染）
 * - 无 selection（旧数据）→ 原样返回描述（保留占位符，不猜测数值）
 * - 未识别占位符（如 @eogvar4@）原样保留
 */
export function fillPerkDescription(
  description: string | undefined,
  selection: GamePerkSelection | undefined
): string {
  if (!description) return ''
  if (!selection) return description
  return description.replace(EOG_VAR_PATTERN, (match, varIndex: string) => {
    switch (varIndex) {
      case '1':
        return String(selection.var1)
      case '2':
        return String(selection.var2)
      case '3':
        return String(selection.var3)
      default:
        return match
    }
  })
}
