/**
 * 出装聚合纯函数单测（出装 tab 数据层）。
 * 覆盖：技能加点序列（等级/EVOLVE）、购买时间线（30s 分隔/售出/撤销）、铁砧计数、
 * 无效字段跳过、空帧容错。
 */
import { describe, expect, it } from 'vitest'
import type { SgpFrame } from '@renderer/services/sgp'
import { ANVIL_ITEM_IDS, buildItemTimeline, collectBuildEvents } from './buildsTable'

function frame(events: Record<string, unknown>[], timestamp = 0): SgpFrame {
  return { timestamp, events: events as SgpFrame['events'], participantFrames: {} }
}

describe('collectBuildEvents 技能加点', () => {
  it('按帧序聚合加点序列并累计等级；EVOLVE 不占级数', () => {
    const frames = [
      frame([
        { type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: 1, levelUpType: 'NORMAL' },
        { type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: 2, levelUpType: 'NORMAL' }
      ]),
      frame([
        { type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: 3, levelUpType: 'NORMAL' },
        { type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: 4, levelUpType: 'EVOLVE' }
      ])
    ]
    const { skills } = collectBuildEvents(frames)
    expect(skills[1]).toEqual([
      { slot: 1, levelUpType: 'NORMAL', displayLevel: 1, timestamp: 0 },
      { slot: 2, levelUpType: 'NORMAL', displayLevel: 2, timestamp: 0 },
      { slot: 3, levelUpType: 'NORMAL', displayLevel: 3, timestamp: 0 },
      { slot: 4, levelUpType: 'EVOLVE', displayLevel: 3, timestamp: 0 }
    ])
  })

  it('非法 skillSlot（<1 或 >4）与无效 participantId 跳过', () => {
    const frames = [
      frame([
        { type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: 0 },
        { type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: 9 },
        { type: 'SKILL_LEVEL_UP', participantId: -1, skillSlot: 1 },
        { type: 'SKILL_LEVEL_UP', participantId: 0, skillSlot: 1 }
      ])
    ]
    expect(collectBuildEvents(frames).skills).toEqual({})
  })

  it('空帧/null 返回空聚合', () => {
    expect(collectBuildEvents(null)).toEqual({ skills: {}, items: {}, anvils: {} })
    expect(collectBuildEvents([])).toEqual({ skills: {}, items: {}, anvils: {} })
  })
})

describe('buildItemTimeline 装备时间线', () => {
  it('购买间隔 >30s 插入分隔符，≤30s 不插', () => {
    const log = [
      { type: 'ITEM_PURCHASED' as const, itemId: 1001, timestamp: 10000 },
      { type: 'ITEM_PURCHASED' as const, itemId: 1002, timestamp: 20000 },
      { type: 'ITEM_PURCHASED' as const, itemId: 1003, timestamp: 80000 }
    ]
    expect(buildItemTimeline(log)).toEqual([
      { kind: 'purchase', itemId: 1001, timestamp: 10000 },
      { kind: 'purchase', itemId: 1002, timestamp: 20000 },
      { kind: 'spacer' },
      { kind: 'purchase', itemId: 1003, timestamp: 80000 }
    ])
  })

  it('售出/撤销原样保留，撤销展示 before→after', () => {
    const log = [
      { type: 'ITEM_PURCHASED' as const, itemId: 1001, timestamp: 10000 },
      { type: 'ITEM_UNDO' as const, beforeId: 1001, afterId: 1002, timestamp: 15000 },
      { type: 'ITEM_PURCHASED' as const, itemId: 1002, timestamp: 16000 },
      { type: 'ITEM_SOLD' as const, itemId: 1001, timestamp: 30000 }
    ]
    expect(buildItemTimeline(log)).toEqual([
      { kind: 'purchase', itemId: 1001, timestamp: 10000 },
      { kind: 'undo', beforeId: 1001, afterId: 1002, timestamp: 15000 },
      { kind: 'purchase', itemId: 1002, timestamp: 16000 },
      { kind: 'sold', itemId: 1001, timestamp: 30000 }
    ])
  })

  it('售出/撤销不重置购买间隔基线（分组只按购买算）', () => {
    const log = [
      { type: 'ITEM_PURCHASED' as const, itemId: 1001, timestamp: 10000 },
      { type: 'ITEM_SOLD' as const, itemId: 1002, timestamp: 45000 },
      { type: 'ITEM_PURCHASED' as const, itemId: 1003, timestamp: 46000 }
    ]
    // 基线始终是 10000（sold 不重置）：46000-10000=36s > 30s → 插分隔符
    const entries = buildItemTimeline(log)
    expect(entries.filter(e => e.kind === 'spacer')).toHaveLength(1)
    // 若 sold 错误重置基线，间隔会变成 1s → 无分隔符；此处证明未重置
    expect(entries[entries.length - 1]).toEqual({
      kind: 'purchase',
      itemId: 1003,
      timestamp: 46000
    })
  })

  it('无效 itemId（0）的购买/出售跳过，不产条目', () => {
    expect(
      buildItemTimeline([{ type: 'ITEM_PURCHASED' as const, itemId: 0, timestamp: 1 }])
    ).toEqual([])
    expect(buildItemTimeline([{ type: 'ITEM_SOLD' as const, itemId: 0, timestamp: 1 }])).toEqual([])
  })
})

describe('collectBuildEvents 装备聚合与铁砧', () => {
  it('按玩家聚合购买时间线；铁砧装备计数', () => {
    const anvilId = ANVIL_ITEM_IDS[0]
    const frames = [
      frame([
        { type: 'ITEM_PURCHASED', participantId: 1, itemId: 1001, timestamp: 10000 },
        { type: 'ITEM_PURCHASED', participantId: 2, itemId: anvilId, timestamp: 12000 },
        { type: 'ITEM_PURCHASED', participantId: 2, itemId: anvilId, timestamp: 13000 },
        { type: 'ITEM_PURCHASED', participantId: 1, itemId: 2001, timestamp: 60000 }
      ])
    ]
    const { items, anvils } = collectBuildEvents(frames)
    expect(items[1]).toEqual([
      { kind: 'purchase', itemId: 1001, timestamp: 10000 },
      { kind: 'spacer' },
      { kind: 'purchase', itemId: 2001, timestamp: 60000 }
    ])
    expect(items[2]).toEqual([
      { kind: 'purchase', itemId: anvilId, timestamp: 12000 },
      { kind: 'purchase', itemId: anvilId, timestamp: 13000 }
    ])
    expect(anvils[2]).toBe(2)
    expect(anvils[1]).toBeUndefined()
  })

  it('SOLD/UNDO 事件也进入时间线（经 collectBuildEvents）', () => {
    const frames = [
      frame([
        { type: 'ITEM_UNDO', participantId: 1, beforeId: 1001, afterId: 1002, timestamp: 15000 }
      ])
    ]
    const { items } = collectBuildEvents(frames)
    expect(items[1]).toEqual([{ kind: 'undo', beforeId: 1001, afterId: 1002, timestamp: 15000 }])
  })
})
