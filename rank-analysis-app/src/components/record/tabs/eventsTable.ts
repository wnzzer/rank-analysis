/**
 * 详情页「事件」tab 的纯函数层：
 * - 事件类型归组（击杀/建筑/中立/塔皮/特殊击杀/其他）
 * - 类型 → 中文标签
 * - 筛选选项定义（全部 + 各类型，带命中判定）
 *
 * 与 `detailsTable.ts` 同层：UI 组件只消费这里的结果，筛选逻辑可单测。
 */

import type { SgpFrameEvent } from '@renderer/services/sgp'

/** 事件归组：决定时间线节点颜色 / 筛选标签 */
export type EventKind = 'kill' | 'building' | 'monster' | 'plate' | 'special' | 'other'

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  kill: '击杀',
  building: '建筑',
  monster: '中立',
  plate: '塔皮',
  special: '特殊击杀',
  other: '其他'
}

/** LCU/SGP 事件类型 → 归组（未知类型一律归「其他」，绝不抛错） */
export function kindOfEvent(ev: Pick<SgpFrameEvent, 'type'>): EventKind {
  switch (ev.type) {
    case 'CHAMPION_KILL':
      return 'kill'
    case 'BUILDING_KILL':
      return 'building'
    case 'ELITE_MONSTER_KILL':
      return 'monster'
    case 'TURRET_PLATE_DESTROYED':
      return 'plate'
    case 'CHAMPION_SPECIAL_KILL':
      return 'special'
    default:
      return 'other'
  }
}

export interface EventFilterOption {
  /** 'all' = 全部事件；否则为归组 kind */
  value: EventKind | 'all'
  label: string
  match: (ev: Pick<SgpFrameEvent, 'type'>) => boolean
}

/** 筛选选项（顺序即 UI 展示顺序：全部在最前，其余按事件密度排序） */
export const EVENT_FILTER_OPTIONS: EventFilterOption[] = [
  { value: 'all', label: '全部', match: () => true },
  { value: 'kill', label: '击杀', match: ev => kindOfEvent(ev) === 'kill' },
  { value: 'building', label: '建筑', match: ev => kindOfEvent(ev) === 'building' },
  { value: 'monster', label: '中立', match: ev => kindOfEvent(ev) === 'monster' },
  { value: 'plate', label: '塔皮', match: ev => kindOfEvent(ev) === 'plate' },
  { value: 'special', label: '特殊击杀', match: ev => kindOfEvent(ev) === 'special' },
  { value: 'other', label: '其他', match: ev => kindOfEvent(ev) === 'other' }
]

/** 按筛选值统计各选项命中数（含 'all'，即事件总数） */
export function countEventKinds(
  events: Pick<SgpFrameEvent, 'type'>[]
): Record<EventKind | 'all', number> {
  const out = { all: events.length } as Record<EventKind | 'all', number>
  for (const kind of Object.keys(EVENT_KIND_LABEL) as EventKind[]) {
    out[kind] = events.filter(ev => kindOfEvent(ev) === kind).length
  }
  return out
}
