/**
 * ItemTimeline：两条时间轴、图标位置、第一件传说装差距（对位 / 全场中位）、偏晚标红。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ItemTimeline from '../ItemTimeline.vue'
import type { ItemMark } from '@renderer/services/ai/review/buildReviewModel'
import { modelB } from './fixtureModels'

const mark = (itemId: number, ms: number, kind: ItemMark['kind'] = 'legendary'): ItemMark => ({
  itemId,
  name: `装备${itemId}`,
  kind,
  ms,
  time: ''
})

describe('ItemTimeline', () => {
  it('真实局：本人与对位两条轴，比对位早 0.8 分钟', () => {
    const model = modelB()
    const me = model.players[9]
    const opp = model.players[4]
    const w = mount(ItemTimeline, {
      props: {
        mine: { label: me.champion, items: me.items },
        other: { label: opp.champion, items: opp.items },
        medianMs: null,
        endMs: model.durationMs
      }
    })
    expect(w.findAll('[data-test="item-mine"]')).toHaveLength(me.items.length)
    expect(w.findAll('[data-test="item-other"]')).toHaveLength(opp.items.length)
    expect(w.find('[data-test="item-gap"]').text()).toBe('· 第一件传说装比对位早 0.8 分钟')
    expect(w.find('[data-test="item-mine"]').attributes('title')).toBe('明朗之靴 8:27')
  })

  it('图标按时间定位；偏晚 ≥2 分钟标红', () => {
    const w = mount(ItemTimeline, {
      props: {
        mine: { label: '我', items: [mark(1, 300000, 'boots'), mark(2, 840000)] },
        other: { label: '对位', items: [mark(3, 600000)] },
        medianMs: null,
        endMs: 1200000
      }
    })
    const icons = w.findAll('[data-test="item-mine"]')
    expect((icons[0].element as HTMLElement).style.left).toBe('25%')
    expect(icons[0].classes()).toContain('item-icon--boots')
    const gap = w.find('[data-test="item-gap"]')
    expect(gap.text()).toBe('· 第一件传说装比对位晚 4.0 分钟')
    expect(gap.classes()).toContain('is-late')
  })

  it('无对位：参照全场中位', () => {
    const w = mount(ItemTimeline, {
      props: {
        mine: { label: '我', items: [mark(2, 600000)] },
        other: null,
        medianMs: 600000,
        endMs: 1200000
      }
    })
    expect(w.find('[data-test="item-median"]').text()).toBe('▲ 10:00')
    expect(w.find('[data-test="item-gap"]').text()).toBe('· 第一件传说装与全场中位同时')
    expect(w.find('[data-test="item-other"]').exists()).toBe(false)
  })

  it('没有传说装：不标差距', () => {
    const w = mount(ItemTimeline, {
      props: {
        mine: { label: '我', items: [mark(1, 300000, 'boots')] },
        other: { label: '对位', items: [mark(3, 600000)] },
        medianMs: null,
        endMs: 1200000
      }
    })
    expect(w.find('[data-test="item-gap"]').exists()).toBe(false)
  })
})
