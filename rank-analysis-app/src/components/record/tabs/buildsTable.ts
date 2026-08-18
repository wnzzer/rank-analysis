/**
 * 详情页「出装」tab 的纯函数层：
 * - 从 SGP DETAILS 帧事件流聚合每名玩家的技能加点序列与装备购买/出售/撤销日志
 * - 渲染规整：购买间隔 >30s 插分隔符（回城批量购买分组）、EVOLVE 标记、铁砧计数
 *
 * 与 `eventsTable.ts` 同层：UI 组件只消费聚合结果，聚合逻辑可单测。
 */

import type { SgpFrame } from '@renderer/features/record/services/sgp'

/** 一次技能加点（按加点顺序排列；EVOLVE 为进化标记，不占级数） */
export interface SkillUpgradeEntry {
  slot: number
  levelUpType?: string | null
  /** 该玩家当前技能等级（加点次数）；EVOLVE 继承上一次的等级 */
  displayLevel: number
  timestamp: number
}

/** 装备日志原始条目（帧序即时间序） */
export interface ItemLogEntry {
  type: 'ITEM_PURCHASED' | 'ITEM_SOLD' | 'ITEM_UNDO'
  itemId?: number | null
  beforeId?: number | null
  afterId?: number | null
  timestamp: number
}

/** 时间线渲染项：购买/出售/撤销/分组分隔符 */
export type ItemTimelineEntry =
  | { kind: 'purchase'; itemId: number; timestamp: number }
  | { kind: 'sold'; itemId: number; timestamp: number }
  | { kind: 'undo'; beforeId: number; afterId: number; timestamp: number }
  | { kind: 'spacer' }

/** 铁砧类特殊装备（安伯萨/阿塔坎相关），购买数量单独标注 */
export const ANVIL_ITEM_IDS = [6032, 220000]

export interface BuildCollection {
  /** participantId → 技能加点序列 */
  skills: Record<number, SkillUpgradeEntry[]>
  /** participantId → 装备时间线（已含 >30s 分隔符） */
  items: Record<number, ItemTimelineEntry[]>
  /** participantId → 铁砧购买次数 */
  anvils: Record<number, number>
}

/** 两次购买间隔超过该毫秒数视为「回城批量购买」，插入分隔符 */
const ITEM_GAP_SPACER_MS = 30000

/** 装备日志 → 渲染时间线：购买间隔 >30s 插分隔符；出售/撤销原样保留 */
export function buildItemTimeline(log: ItemLogEntry[]): ItemTimelineEntry[] {
  const out: ItemTimelineEntry[] = []
  let lastPurchaseTs = 0
  for (const entry of log) {
    if (entry.type === 'ITEM_PURCHASED') {
      const itemId = entry.itemId ?? 0
      if (lastPurchaseTs !== 0 && entry.timestamp - lastPurchaseTs > ITEM_GAP_SPACER_MS) {
        out.push({ kind: 'spacer' })
      }
      lastPurchaseTs = entry.timestamp
      if (itemId > 0) out.push({ kind: 'purchase', itemId, timestamp: entry.timestamp })
    } else if (entry.type === 'ITEM_SOLD') {
      const itemId = entry.itemId ?? 0
      if (itemId > 0) out.push({ kind: 'sold', itemId, timestamp: entry.timestamp })
    } else if (entry.type === 'ITEM_UNDO') {
      const beforeId = entry.beforeId ?? 0
      const afterId = entry.afterId ?? 0
      if (beforeId > 0 || afterId > 0) {
        out.push({ kind: 'undo', beforeId, afterId, timestamp: entry.timestamp })
      }
    }
  }
  return out
}

/**
 * 聚合全部帧事件 → 每名玩家的技能加点 + 装备时间线 + 铁砧计数。
 * 帧序即时间序（DETAILS 每帧按分钟排序），无需额外排序。
 */
export function collectBuildEvents(frames: SgpFrame[] | null | undefined): BuildCollection {
  const skills: BuildCollection['skills'] = {}
  const itemLogs: Record<number, ItemLogEntry[]> = {}
  const anvils: BuildCollection['anvils'] = {}

  for (const frame of frames ?? []) {
    for (const ev of frame.events ?? []) {
      const pid = ev.participantId ?? ev.killerId
      if (pid == null || pid <= 0) continue
      const ts = ev.timestamp ?? 0

      if (ev.type === 'SKILL_LEVEL_UP') {
        const slot = ev.skillSlot ?? 0
        if (slot < 1 || slot > 4) continue
        const list = (skills[pid] ??= [])
        const prev = list[list.length - 1]
        const displayLevel =
          ev.levelUpType === 'EVOLVE' ? (prev?.displayLevel ?? 0) : (prev?.displayLevel ?? 0) + 1
        list.push({ slot, levelUpType: ev.levelUpType, displayLevel, timestamp: ts })
      } else if (
        ev.type === 'ITEM_PURCHASED' ||
        ev.type === 'ITEM_SOLD' ||
        ev.type === 'ITEM_UNDO'
      ) {
        const itemId = ev.itemId ?? 0
        itemLogs[pid] = itemLogs[pid] ?? []
        itemLogs[pid].push({
          type: ev.type,
          itemId,
          beforeId: ev.beforeId,
          afterId: ev.afterId,
          timestamp: ts
        })
        if (ev.type === 'ITEM_PURCHASED' && ANVIL_ITEM_IDS.includes(itemId)) {
          anvils[pid] = (anvils[pid] ?? 0) + 1
        }
      }
    }
  }

  const items: BuildCollection['items'] = {}
  for (const [pid, log] of Object.entries(itemLogs)) {
    items[Number(pid)] = buildItemTimeline(log)
  }
  return { skills, items, anvils }
}
