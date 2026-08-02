/**
 * ChampionIntelCard 纯逻辑辅助函数
 *
 * 与组件渲染解耦，便于单测覆盖 pick-state 分类、T 级徽章语义色、胜率格式化等纯计算。
 */

/** 选人阶段 pick 态：未选中 / 意向 / 禁用中 / 选择中 / 已锁定 */
export type PickState = 'none' | 'intent' | 'banning' | 'picking' | 'locked'

/**
 * pick 态 → 卡片修饰类名（驱动 CSS 多态动画）
 * @param state - pick 态字符串，缺省或未知值一律兜底为 'none'
 * @returns 'intel-intent' | 'intel-banning' | 'intel-picking' | 'intel-locked' | 'intel-none'
 * @example
 * ```ts
 * pickStateClass('locked') // 'intel-locked'
 * pickStateClass('banning') // 'intel-banning'
 * pickStateClass(undefined) // 'intel-none'
 * ```
 */
export function pickStateClass(state: string | undefined): string {
  switch (state) {
    case 'intent':
      return 'intel-intent'
    case 'banning':
      return 'intel-banning'
    case 'picking':
      return 'intel-picking'
    case 'locked':
      return 'intel-locked'
    default:
      return 'intel-none'
  }
}

/**
 * pick 态 → PlayerCard 修饰类名（我方选人期四态动画）
 * 与 pickStateClass 的区别：PlayerCard 常驻对局中样式，非选人期（'none'/空/未知值）
 * 一律不加类，避免对局中卡片被误套选人态视觉。
 * @param state - pick 态字符串，缺省或未知值统一兜底为无类
 * @returns 'pc-intent' | 'pc-picking' | 'pc-banning' | 'pc-locked' | ''（无修饰）
 * @example
 * ```ts
 * playerCardPickStateClass('locked') // 'pc-locked'
 * playerCardPickStateClass('none') // ''
 * playerCardPickStateClass(undefined) // ''
 * ```
 */
export function playerCardPickStateClass(state: string | undefined): string {
  switch (state) {
    case 'intent':
      return 'pc-intent'
    case 'picking':
      return 'pc-picking'
    case 'banning':
      return 'pc-banning'
    case 'locked':
      return 'pc-locked'
    default:
      return ''
  }
}

/**
 * T 级数字 → 徽章文案、语义色 token 与背景色（pill chip 用）
 * @param tier - OP.GG 英雄强度分级（1 最强 ~ 5 最弱，0 表示无数据）
 * @returns 徽章文案（如 'T1'）、CSS 变量颜色、对应色 15% 透明度背景；tier 为 0 时全空
 * @example
 * ```ts
 * tierBadge(1) // { label: 'T1', color: 'var(--semantic-win)', bg: 'color-mix(...)' }
 * tierBadge(0) // { label: '', color: '', bg: '' }
 * ```
 */
export function tierBadge(tier: number): { label: string; color: string; bg: string } {
  switch (tier) {
    case 1:
      return {
        label: 'T1',
        color: 'var(--semantic-win)',
        bg: 'color-mix(in srgb, var(--semantic-win) 15%, transparent)'
      }
    case 2:
      return {
        label: 'T2',
        color: 'var(--accent-blue)',
        bg: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)'
      }
    case 3:
      return {
        label: 'T3',
        color: 'var(--text-secondary)',
        bg: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)'
      }
    case 4:
      return {
        label: 'T4',
        color: 'var(--text-tertiary)',
        bg: 'color-mix(in srgb, var(--text-tertiary) 15%, transparent)'
      }
    case 5:
      return {
        label: 'T5',
        color: 'var(--text-tertiary)',
        bg: 'color-mix(in srgb, var(--text-tertiary) 15%, transparent)'
      }
    default:
      return { label: '', color: '', bg: '' }
  }
}

/**
 * 判断两次 championId 变化是否构成"真正的换人"（trade swap），而非首次亮出/清空。
 * ChampionIntelCard 与 PlayerCard 共用此判定来决定是否播放一次性换人闪烁动画。
 * @param oldId - 变化前的 championId
 * @param newId - 变化后的 championId
 * @returns 仅当 oldId、newId 均为正数且不相等时为 true（首次从 0/undefined 亮出英雄不算换人）
 * @example
 * ```ts
 * isChampionSwap(0, 1) // false（首次亮出）
 * isChampionSwap(1, 2) // true（真换人）
 * isChampionSwap(1, 1) // false（未变化）
 * isChampionSwap(undefined, 1) // false（初次挂载）
 * ```
 */
export function isChampionSwap(oldId: number | undefined, newId: number | undefined): boolean {
  return !!oldId && oldId > 0 && !!newId && newId > 0 && oldId !== newId
}

/**
 * PlayerCard 标签区可见系统标签上限
 *
 * 标签区（.profile-tags）是 flex-shrink:0 的硬占位，越宽越挤压中间信息列，
 * 信息列一窄 OP.GG 胜率 chip 就会从段位行被挤换行，卡片凭空高出一行。
 * 预组队/遇见过属于宽幅特殊 chip，各按 2 个系统标签名额折算：任一出现时
 * 系统标签（连败/连胜等）全部收进 +N popover，保住"信息列两行"结构。
 *
 * @param hasPreGroup - 是否有预组队标记 chip
 * @param hasMeet - 是否有「遇见过 ×N」chip
 * @returns 直接可见的系统标签数上限（0 表示全部收进 +N）
 * @example
 * ```ts
 * tagVisibleCap(false, false) // 2
 * tagVisibleCap(false, true) // 0（遇见过在场，连败等收进 +N）
 * ```
 */
export function tagVisibleCap(hasPreGroup: boolean, hasMeet: boolean): number {
  let cap = 2
  if (hasPreGroup) cap -= 2
  if (hasMeet) cap -= 2
  return Math.max(cap, 0)
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
