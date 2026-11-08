import { describe, it, expect } from 'vitest'
import {
  buildTimelineCards,
  selectCards,
  renderCardLines,
  isTargetedEligible,
  visibleCards
} from '../index'
import { ROSTER, input } from './helpers'
import type { SlimTimeline, TimelineCard } from '../types'
import ranked from './fixtures/ranked.slim.json'
import kiwi from './fixtures/kiwi.slim.json'

const card = (
  id: string,
  kind: TimelineCard['kind'],
  subjects: number[],
  weight = 1
): TimelineCard => ({
  id,
  kind,
  subjects,
  minute: 1,
  text: id,
  numbers: [],
  weight
})

describe('selectCards', () => {
  const cards = [
    card('T1', 'turn', []),
    card('F1', 'fight', [1, 2]),
    card('F2', 'fight', [6]),
    card('D1', 'death', [1, 6], 3),
    card('D2', 'death', [1, 7], 1),
    card('I1', 'item', [1], 2),
    card('D3', 'death', [6, 1], 1)
  ]

  it('overview keeps all T/F and top-1 per owner', () => {
    expect(selectCards(cards, { mode: 'overview' }).map(c => c.id)).toEqual([
      'T1',
      'F1',
      'F2',
      'D1',
      'D3'
    ])
  })

  it('caps fights to the top 8 by weight (ties earlier first) in both modes', () => {
    const fights = Array.from({ length: 12 }, (_, i) =>
      card(`F${i + 1}`, 'fight', [1], [1, 5, 2, 9, 2, 3, 3, 4, 8, 1, 1, 7][i])
    )
    // 权重降序：F4(9) F9(8) F12(7) F2(5) F8(4) F6(3) F7(3) 然后 F3/F5(2) 中取更早的 F3
    const expected = ['F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F12']
    expect(selectCards(fights, { mode: 'overview' }).map(c => c.id)).toEqual(expected)
    expect(selectCards(fights, { mode: 'player', participantId: 1 }).map(c => c.id)).toEqual(
      expected
    )
  })

  it('player keeps own cards, all turns and top fights', () => {
    expect(selectCards(cards, { mode: 'player', participantId: 1 }).map(c => c.id)).toEqual([
      'T1',
      'F1',
      'F2',
      'D1',
      'D2',
      'I1'
    ])
  })

  it('visibleCards overview equals the overview selection', () => {
    expect(visibleCards(cards, 'overview').map(c => c.id)).toEqual(
      selectCards(cards, { mode: 'overview' }).map(c => c.id)
    )
  })

  it('visibleCards player is only the player selection: overview-only ids are not visible', () => {
    // D3 只在整局选卡里（玩家 6 的最高权重卡），单人 prompt 里没有
    const ids = visibleCards(cards, 'player', 1).map(c => c.id)
    expect(ids).toEqual(['T1', 'F1', 'F2', 'D1', 'D2', 'I1'])
    expect(ids).not.toContain('D3')
  })

  it('visibleCards player adds cards cited in winReason', () => {
    const ids = visibleCards(cards, 'player', 1, '蓝方领先；[D3] 被引用，[T1] 经济转折。').map(
      c => c.id
    )
    expect(ids).toContain('D3')
    expect(ids).toContain('T1')
    expect(ids).toEqual(['T1', 'F1', 'F2', 'D1', 'D2', 'I1', 'D3'])
  })

  it('visibleCards player without participantId falls back to overview', () => {
    expect(visibleCards(cards, 'player').map(c => c.id)).toEqual(
      selectCards(cards, { mode: 'overview' }).map(c => c.id)
    )
  })
})

describe('renderCardLines / isTargetedEligible', () => {
  it('should render one line per card', () => {
    expect(renderCardLines([card('D1', 'death', [1])])).toBe('[D1] D1')
  })

  it('should require ≥3 deaths and ≥60% with 3+ attackers', () => {
    const d = (id: string, attackers: number) =>
      card(id, 'death', [1, ...Array.from({ length: attackers }, (_, i) => 6 + i)])
    expect(isTargetedEligible([d('D1', 3), d('D2', 3), d('D3', 1)], 1, true)).toBe(true)
    expect(isTargetedEligible([d('D1', 3), d('D2', 1), d('D3', 1)], 1, true)).toBe(false)
    expect(isTargetedEligible([d('D1', 3), d('D2', 3)], 1, true)).toBe(false)
  })

  it('should never be eligible without lanes (teamfight modes gank by default)', () => {
    const d = (id: string) => card(id, 'death', [1, 6, 7, 8])
    expect(isTargetedEligible([d('D1'), d('D2'), d('D3')], 1, false)).toBe(false)
    expect(isTargetedEligible([d('D1'), d('D2'), d('D3')], 1, true)).toBe(true)
  })
})

describe('buildTimelineCards', () => {
  it('should number per kind chronologically and extract numbers', () => {
    const cards = buildTimelineCards(
      input({
        frames: [],
        events: [
          {
            type: 'CHAMPION_KILL',
            timestamp: 120000,
            killerId: 7,
            victimId: 4,
            assisting: [],
            x: 0,
            y: 0,
            bounty: 300,
            shutdownBounty: 0,
            damageReceived: []
          },
          {
            type: 'CHAMPION_KILL',
            timestamp: 60000,
            killerId: 8,
            victimId: 5,
            assisting: [],
            x: 0,
            y: 0,
            bounty: 300,
            shutdownBounty: 0,
            damageReceived: []
          }
        ]
      })
    )
    const deaths = cards.filter(c => c.kind === 'death')
    expect(deaths.map(c => [c.id, c.subjects[0]])).toEqual([
      ['D1', 5],
      ['D2', 4]
    ])
    expect(deaths[0].numbers).toContain(1)
    expect(deaths[0].numbers).toContain(0)
  })

  it.each([
    ['ranked', ranked as unknown as SlimTimeline, true, 11],
    ['kiwi', kiwi as unknown as SlimTimeline, false, 12]
  ])('should build sane cards from real %s fixture', (_, tl, hasLanes, mapId) => {
    const cards = buildTimelineCards({ tl, roster: ROSTER, hasLanes, hasItemBuild: true, mapId })
    const ids = cards.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(cards.some(c => c.kind === 'death')).toBe(true)
    expect(cards.some(c => c.kind === 'fight')).toBe(true)
    expect(cards.some(c => c.kind === 'item')).toBe(true)
    expect(cards.every(c => !/NaN|undefined/.test(c.text))).toBe(true)
    expect(cards.every(c => c.subjects.every(s => s >= 1 && s <= 10))).toBe(true)
    if (!hasLanes) expect(cards.some(c => c.kind === 'lane' || c.kind === 'vision')).toBe(false)
  })
})
