/**
 * ChampionIntelCard 纯逻辑辅助函数
 *
 * 与组件渲染解耦，便于单测覆盖 pick-state 分类、T 级徽章语义色、胜率格式化等纯计算。
 */

/** 选人阶段 pick 态：未选中 / 意向 / 选择中 / 已锁定 */
export type PickState = 'none' | 'intent' | 'picking' | 'locked'

/**
 * pick 态 → 卡片修饰类名（驱动 CSS 三态动画）
 * @param state - pick 态字符串，缺省或未知值一律兜底为 'none'
 * @returns 'intel-intent' | 'intel-picking' | 'intel-locked' | 'intel-none'
 * @example
 * ```ts
 * pickStateClass('locked') // 'intel-locked'
 * pickStateClass(undefined) // 'intel-none'
 * ```
 */
export function pickStateClass(state: string | undefined): string {
  switch (state) {
    case 'intent':
      return 'intel-intent'
    case 'picking':
      return 'intel-picking'
    case 'locked':
      return 'intel-locked'
    default:
      return 'intel-none'
  }
}

/**
 * T 级数字 → 徽章文案与语义色 token
 * @param tier - OP.GG 英雄强度分级（1 最强 ~ 5 最弱，0 表示无数据）
 * @returns 徽章文案（如 'T1'）与对应 CSS 变量颜色；tier 为 0 时返回空徽章
 * @example
 * ```ts
 * tierBadge(1) // { label: 'T1', color: 'var(--semantic-win)' }
 * tierBadge(0) // { label: '', color: '' }
 * ```
 */
export function tierBadge(tier: number): { label: string; color: string } {
  switch (tier) {
    case 1:
      return { label: 'T1', color: 'var(--semantic-win)' }
    case 2:
      return { label: 'T2', color: 'var(--accent-blue)' }
    case 3:
      return { label: 'T3', color: 'var(--text-secondary)' }
    case 4:
      return { label: 'T4', color: 'var(--text-tertiary)' }
    case 5:
      return { label: 'T5', color: 'var(--text-tertiary)' }
    default:
      return { label: '', color: '' }
  }
}

/**
 * 胜率显示：将 0~1 的小数格式化为百分比字符串
 * @param rate - 胜率（0~1），缺省或 <=0 视为无数据
 * @returns 形如 '51.8%' 的字符串；无数据时返回 '--'
 * @example
 * ```ts
 * formatWinRate(0.5183) // '51.8%'
 * formatWinRate(undefined) // '--'
 * ```
 */
export function formatWinRate(rate: number | undefined): string {
  if (rate === undefined || rate <= 0) return '--'
  return `${(rate * 100).toFixed(1)}%`
}
