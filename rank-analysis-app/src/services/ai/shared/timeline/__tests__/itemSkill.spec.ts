import { describe, it, expect } from 'vitest'
import { buildItemCards } from '../cards/item'
import { buildSkillCards } from '../cards/skill'
import { input } from './helpers'
import type { SlimEvent } from '../types'

const items = {
  '3031': { name: '无尽之刃', priceTotal: 3450, kind: 'legendary' as const },
  '3006': { name: '狂战士胫甲', priceTotal: 1100, kind: 'boots' as const },
  '1038': { name: '暴风之剑', priceTotal: 1300, kind: 'other' as const },
  '6672': { name: '海妖杀手', priceTotal: 3000, kind: 'legendary' as const }
}
const buy = (timestamp: number, participantId: number, itemId: number): SlimEvent => ({
  type: 'ITEM_PURCHASED',
  timestamp,
  participantId,
  itemId
})
const events: SlimEvent[] = [
  buy(400000, 4, 3006),
  buy(500000, 4, 1038),
  buy(840000, 9, 6672),
  buy(900000, 4, 3031),
  { type: 'ITEM_UNDO', timestamp: 905000, participantId: 4, beforeId: 3031, afterId: 0 },
  buy(960000, 4, 3031),
  buy(1300000, 4, 6672),
  { type: 'ITEM_SOLD', timestamp: 1500000, participantId: 9, itemId: 6672 }
]

describe('buildItemCards', () => {
  it('should list completed items, drop undone purchases, compare with lane opponent', () => {
    const cards = buildItemCards(input({ events, items }))
    expect(cards.find(c => c.subjects[0] === 4)?.text).toBe(
      '卡莎 出装｜狂战士胫甲 6:40、无尽之刃 16:00、海妖杀手 21:40｜第一件传说装 16:00，比对位 EZ（14:00）晚 2.0 分钟'
    )
    expect(cards.find(c => c.subjects[0] === 9)?.text).toBe(
      'EZ 出装｜海妖杀手 14:00｜第一件传说装 14:00，比对位 卡莎（16:00）早 2.0 分钟｜卖出 海妖杀手'
    )
    expect(cards.find(c => c.subjects[0] === 4)?.weight).toBe(2)
    expect(cards).toHaveLength(2)
  })

  it('should compare with game median when no lanes', () => {
    const cards = buildItemCards(input({ events, items }, { hasLanes: false }))
    expect(cards.find(c => c.subjects[0] === 4)?.text).toContain(
      '第一件传说装 16:00，比全场中位（15:00）晚 1.0 分钟'
    )
  })

  it('should skip when mode has no item build', () => {
    expect(buildItemCards(input({ events, items }, { hasItemBuild: false }))).toEqual([])
  })

  it('should drop sales that were undone', () => {
    const undone: SlimEvent[] = [
      ...events,
      { type: 'ITEM_UNDO', timestamp: 1510000, participantId: 9, beforeId: 0, afterId: 6672 }
    ]
    const cards = buildItemCards(input({ events: undone, items }))
    expect(cards.find(c => c.subjects[0] === 9)?.text).not.toContain('卖出')
  })

  it('should not compare with median when only one player has a legendary', () => {
    const solo: SlimEvent[] = [
      buy(400000, 4, 3006),
      buy(900000, 4, 3031),
      { type: 'ITEM_UNDO', timestamp: 905000, participantId: 4, beforeId: 3031, afterId: 0 },
      buy(960000, 4, 3031)
    ]
    const cards = buildItemCards(input({ events: solo, items }, { hasLanes: false }))
    expect(cards.find(c => c.subjects[0] === 4)?.text).toBe(
      '卡莎 出装｜狂战士胫甲 6:40、无尽之刃 16:00｜第一件传说装 16:00'
    )
  })
})

describe('buildSkillCards', () => {
  const ups = (pid: number, slots: number[]): SlimEvent[] =>
    slots.map((skillSlot, i) => ({
      type: 'SKILL_LEVEL_UP',
      timestamp: i * 1000,
      participantId: pid,
      skillSlot,
      levelUpType: 'NORMAL'
    }))

  it('should derive max order and on-time ult', () => {
    const cards = buildSkillCards(
      input({ events: ups(1, [1, 2, 3, 1, 1, 4, 1, 1, 3, 3, 4, 3, 3, 2, 2, 4, 2, 2]) })
    )
    expect(cards[0]).toMatchObject({ subjects: [1], weight: 0.3 })
    expect(cards[0].text).toBe('剑魔 加点｜主Q 副E｜大招 按时（6/11/16 级）')
  })

  it('should flag late ult', () => {
    const cards = buildSkillCards(input({ events: ups(2, [1, 2, 3, 1, 1, 1, 4, 1]) }))
    expect(cards[0]).toMatchObject({ subjects: [2], weight: 1 })
    expect(cards[0].text).toBe('盲僧 加点｜主Q 副W｜大招 第1次晚 1 级')
  })

  it('should flag unlearned second ult at level 12+', () => {
    const cards = buildSkillCards(input({ events: ups(3, [1, 2, 3, 1, 1, 4, 1, 1, 3, 3, 2, 2]) }))
    expect(cards[0]).toMatchObject({ subjects: [3], weight: 1 })
    expect(cards[0].text).toContain('大招 第2次未学')
  })

  it('should mark order as provisional when no slot reached 5 points', () => {
    const cards = buildSkillCards(input({ events: ups(9, [1, 1, 2, 3, 1]) }))
    expect(cards[0]).toMatchObject({ subjects: [9], weight: 0.3 })
    expect(cards[0].text).toBe('EZ 加点｜主Q 副W（未满级，按点数）｜大招 未学')
  })
})
