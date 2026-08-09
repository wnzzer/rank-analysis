/**
 * OP.GG 情报与分路展示的小助手（选人期与对局中分析共用）。
 * 注意：OP.GG "主分路"是版本统计推测；LCU assignedPosition/selectedPosition 才是本局权威。
 */

import { getChampionName } from '../../champion-names'

/** LCU/OP.GG 分路命名（大写）→ 中文 */
export const POSITION_CN: Record<string, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助'
}

/**
 * OP.GG 主分路 → 中文展示片段，position 为空串（aram 等无分路模式）时不展示该段。
 * 带"（推测）"标注：这是版本统计上该英雄最常见的分路，不是本局的权威分路。
 */
export function positionSegment(position: string | undefined): string {
  const cn = position ? POSITION_CN[position] : undefined
  return cn ? `｜主分路${cn}（推测）` : ''
}

/**
 * LCU 本局分路（选人期小写 assignedPosition / 对局中大写 selectedPosition）→ 中文片段。
 * 空串（匹配/大乱斗等无分配模式）时不展示该段。
 */
export function assignedPositionSegment(position: string | undefined): string {
  const cn = position ? POSITION_CN[position.toUpperCase()] : undefined
  return cn ? `｜本局分路${cn}` : ''
}

/** 本局分路 → 纯中文名（无数据时返回空串），供非"｜片段"场景使用 */
export function assignedPositionCn(position: string | undefined): string {
  return (position && POSITION_CN[position.toUpperCase()]) || ''
}

/** OP.GG tier 数字 → 展示文案，0/undefined 视为无数据 */
export function tierLabel(tier: number | undefined): string {
  return tier ? `T${tier}` : '无数据'
}

/** 克制提示 → 一句话文案，正向（怕我方）与负向（克制我方）分开措辞 */
export function counterHintText(myWinRate: number, myChampionId: number): string {
  const myName = getChampionName(myChampionId)
  return myWinRate >= 0.5
    ? `怕我方${myName}（${(myWinRate * 100).toFixed(0)}%）`
    : `克制我方${myName}（${((1 - myWinRate) * 100).toFixed(0)}%）`
}
