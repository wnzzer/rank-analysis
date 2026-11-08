/**
 * DeathMap：阵亡点数量、坐标换算、责任着色、悬停联动。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DeathMap from '../DeathMap.vue'
import { RESPONSIBILITY_CN } from '@renderer/services/ai/review/buildReviewModel'
import { modelB } from './fixtureModels'

const deaths = modelB().players[9].deathList!

describe('DeathMap', () => {
  it('每次阵亡一个点，位置按地图坐标缩放、颜色 = 责任', () => {
    const w = mount(DeathMap, { props: { deaths, hovered: null } })
    const dots = w.findAll('[data-test="map-dot"]')
    expect(dots).toHaveLength(11)
    const first = dots[0].element as HTMLElement
    expect(parseFloat(first.style.left)).toBeCloseTo(92.62, 1)
    expect(parseFloat(first.style.top)).toBeCloseTo(73.66, 1)
    expect(first.style.background).toBe('var(--resp-other)')
    expect(dots[0].attributes('title')).toBe('4:54 下路（红方半场） · 其他')
  })

  it('坐标缺失的阵亡不画点（不落在蓝方基地）', () => {
    const partial = deaths.map((d, i) => (i === 0 ? { ...d, x: null, y: null } : d))
    const w = mount(DeathMap, { props: { deaths: partial, hovered: null } })
    const dots = w.findAll('[data-test="map-dot"]')
    expect(dots).toHaveLength(10)
    expect(dots[0].attributes('title')).toBe(
      `${deaths[1].time} ${deaths[1].zone} · ${RESPONSIBILITY_CN[deaths[1].resp]}`
    )
  })

  it('hovered 放大对应点；悬停发出序号', async () => {
    const w = mount(DeathMap, { props: { deaths, hovered: 1 } })
    const dots = w.findAll('[data-test="map-dot"]')
    expect(dots[1].classes()).toContain('is-hovered')
    await dots[4].trigger('mouseenter')
    await dots[4].trigger('mouseleave')
    expect(w.emitted('hover')).toEqual([[4], [null]])
  })
})
