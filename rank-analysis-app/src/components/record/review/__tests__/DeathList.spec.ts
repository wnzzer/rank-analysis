/**
 * DeathList：每次阵亡一行、责任徽章、分类计数、悬停事件、定位高亮与滚动、无时间线小结。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DeathList from '../DeathList.vue'
import { modelB } from './fixtureModels'

const me = modelB().players[9]

function mountList(overrides: Partial<InstanceType<typeof DeathList>['$props']> = {}) {
  return mount(DeathList, {
    props: {
      deaths: me.deathList,
      summary: me.deathSummary,
      counts: me.deathCounts,
      hovered: null,
      focused: null,
      ...overrides
    }
  })
}

describe('DeathList', () => {
  it('每次阵亡一行：时间、地点、击杀者、责任徽章', () => {
    const w = mountList()
    const rows = w.findAll('[data-test="death-row"]')
    expect(rows).toHaveLength(11)
    expect(rows[0].text()).toContain('4:54')
    expect(rows[0].text()).toContain('下路（红方半场）')
    expect(rows[0].text()).toContain('英雄45')
    expect(rows[1].find('.death-chip').text()).toBe('自身问题')
    expect(rows[1].find('.death-chip').classes()).toContain('death-chip--self')
  })

  it('末行分类计数（省略 0 次）', () => {
    expect(mountList().find('[data-test="death-counts"]').text()).toBe(
      '共 11 次：自身问题 4 · 部分责任 1 · 情有可原 2 · 团战中 2 · 其他 2'
    )
  })

  it('悬停发出序号，移出发出 null；hovered/focused 高亮', async () => {
    const w = mountList({ hovered: 2, focused: 3 })
    const rows = w.findAll('[data-test="death-row"]')
    expect(rows[2].classes()).toContain('is-hovered')
    expect(rows[3].classes()).toContain('is-focused')
    await rows[5].trigger('mouseenter')
    await rows[5].trigger('mouseleave')
    expect(w.emitted('hover')).toEqual([[5], [null]])
  })

  it('focused 变化时把该行滚进视野', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const w = mountList()
    await w.setProps({ focused: 7 })
    await new Promise(r => setTimeout(r, 0))
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('无时间线：只显示小结', () => {
    const noTl = modelB({ timeline: false }).players[9]
    const w = mountList({ deaths: null, summary: noTl.deathSummary, counts: null })
    expect(w.find('[data-test="death-summary"]').text()).toBe('阵亡 11 次（无时间线，无法细分）')
    expect(w.find('[data-test="death-row"]').exists()).toBe(false)
  })

  it('时间线加载中：显示加载提示而非小结', () => {
    const w = mountList({ deaths: null, counts: null, loading: true })
    expect(w.find('[data-test="death-loading"]').exists()).toBe(true)
    expect(w.find('[data-test="death-summary"]').exists()).toBe(false)
  })
})
