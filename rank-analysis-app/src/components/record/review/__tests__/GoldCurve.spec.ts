/**
 * GoldCurve：标记数量与位置、点击发出 update:openId、受控弹出卡（团战详情/资源）、阵亡点着色、悬停读数。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GoldCurve from '../GoldCurve.vue'
import ObjectiveIcon from '../ObjectiveIcon.vue'
import { modelB } from './fixtureModels'

const model = modelB()
const curve = model.goldCurve!

function mountCurve(openId: string | null = null, deaths = model.players[9].deathList) {
  return mount(GoldCurve, { props: { curve, deaths, openId } })
}

describe('GoldCurve', () => {
  it('团战与资源标记各自成行', () => {
    const w = mountCurve()
    expect(w.findAll('[data-test="curve-marker"]')).toHaveLength(curve.markers.length)
    expect(w.findAll('.gold-curve-marker--fight')).toHaveLength(18)
    expect(w.findAll('.gold-curve-marker--objective')).toHaveLength(13)
    expect(w.find('.gold-curve-line').attributes('d')).toMatch(/^M0\.00 /)
  })

  it('资源标记用 ObjectiveIcon（小龙带元素与拿下方外圈），团战仍是 ⚔️', () => {
    const w = mountCurve()
    const objs = w.findAllComponents(ObjectiveIcon)
    const inMarkers = w.findAll('.gold-curve-marker--objective img')
    expect(inMarkers).toHaveLength(13)
    expect(objs.length).toBeGreaterThanOrEqual(13)
    const first = w.find('[data-id="O1"] img')
    expect(first.attributes('alt')).toMatch(/^小龙/)
    expect(first.attributes('src')).toMatch(/dragon_/)
    expect(w.find('[data-id="O1"] .objective-icon').classes()).toContain('objective-icon--red')
    expect(w.find('.gold-curve-marker--fight svg').exists()).toBe(false)
    expect(w.text()).not.toContain('🐉')
  })

  it('点击标记发出 update:openId；再次点击已展开的标记关闭', async () => {
    const w = mountCurve()
    await w.find('[data-id="F1"]').trigger('click')
    expect(w.emitted('update:openId')).toEqual([['F1']])

    const open = mountCurve('F1')
    await open.find('[data-id="F1"]').trigger('click')
    expect(open.emitted('update:openId')).toEqual([[null]])
  })

  it('openId 指向团战：弹出卡显示标题与人头比/参战/缺席/团后资源', () => {
    const w = mountCurve('F1')
    const pop = w.find('[data-test="curve-popover"]')
    expect(pop.exists()).toBe(true)
    expect(pop.text()).toContain('6:53 下半河道团战（13 秒）')
    expect(pop.text()).toContain('人头 蓝方2:2红方')
    expect(pop.findAll('.gold-curve-popover-line')).toHaveLength(4)
  })

  it('openId 指向资源：弹出卡只有标题；关闭按钮发出 null', async () => {
    const w = mountCurve('O1')
    const pop = w.find('[data-test="curve-popover"]')
    expect(pop.text()).toContain('7:37 红方拿下小龙')
    expect(pop.findAll('.gold-curve-popover-line')).toHaveLength(0)
    await pop.find('.gold-curve-popover-close').trigger('click')
    expect(w.emitted('update:openId')).toEqual([[null]])
  })

  it('选中玩家阵亡点按责任着色；无阵亡数据时不画', () => {
    const w = mountCurve()
    const dots = w.findAll('[data-test="curve-death"]')
    expect(dots).toHaveLength(11)
    expect((dots[1].element as HTMLElement).style.background).toBe('var(--resp-self)')
    expect(mountCurve(null, null).findAll('[data-test="curve-death"]')).toHaveLength(0)
  })

  it('悬停显示最近一帧的时刻与经济差', async () => {
    const w = mountCurve()
    const plot = w.find('[data-test="curve-plot"]')
    ;(plot.element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 140 }) as DOMRect
    await plot.trigger('mousemove', { clientX: 0 })
    expect(w.find('[data-test="curve-readout"]').text()).toBe('0:00 经济持平')
    await plot.trigger('mouseleave')
    expect(w.find('[data-test="curve-readout"]').exists()).toBe(false)
  })
})
