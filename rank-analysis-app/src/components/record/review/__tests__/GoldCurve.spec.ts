/**
 * GoldCurve：标记数量与位置、点击发出 update:openId、受控弹出卡（团战详情/资源）、阵亡点着色、悬停读数。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GoldCurve from '../GoldCurve.vue'
import ObjectiveIcon from '../ObjectiveIcon.vue'
import type { GoldCurve as GoldCurveModel } from '@renderer/services/ai/review/buildReviewModel'
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

const wpCurve = {
  ...curve,
  winProb: {
    points: Array.from({ length: 30 }, (_, i) => ({ minute: i + 1, p: i < 19 ? 0.6 : 0.8 })),
    turns: [
      { minute: 20, from: 0.49, to: 0.74, text: '团战蓝方 4 换 3，蓝方拿下小龙' },
      { minute: 25, from: 0.7, to: 0.55, text: '红方拿下大龙' }
    ]
  },
  mySide: 'red' as const
}

describe('GoldCurve 胜率模式', () => {
  const mountWp = (c: GoldCurveModel = wpCurve) =>
    mount(GoldCurve, { props: { curve: c, deaths: null, openId: null } })

  it('有胜率时默认胜率模式，标题与图例对应', () => {
    const w = mountWp()
    expect(w.find('[data-test="curve-mode"]').exists()).toBe(true)
    expect(w.text()).toContain('胜率曲线（上 = 蓝方占优）')
    expect(w.text()).toContain('你在红方')
    expect(w.findAll('[data-test="curve-turn"]')).toHaveLength(2)
  })

  it('转折徽标：幅度与颜色随有利方', () => {
    const w = mountWp()
    const [up, down] = w.findAll('[data-test="curve-turn-badge"]')
    expect(up.text()).toBe('+25')
    expect(up.classes()).toContain('is-blue')
    expect(down.text()).toBe('-15')
    expect(down.classes()).toContain('is-red')
  })

  it('点徽标弹出说明含胜率变化', async () => {
    const w = mountWp()
    await w.findAll('[data-test="curve-turn-badge"]')[0].trigger('click')
    expect(w.find('[data-test="curve-turn-popover"]').text()).toContain(
      '团战蓝方 4 换 3，蓝方拿下小龙。蓝方胜率 49% → 74%'
    )
  })

  it('切到经济差：转折消失，原有标记仍在', async () => {
    const w = mountWp()
    await w.find('[data-test="curve-mode-gold"]').trigger('click')
    expect(w.text()).toContain('经济差曲线')
    expect(w.findAll('[data-test="curve-turn"]')).toHaveLength(0)
    expect(w.findAll('[data-test="curve-marker"]')).toHaveLength(curve.markers.length)
  })

  it('没有胜率：不出现切换，保持经济差', () => {
    const w = mountWp({ ...curve, winProb: null, mySide: null })
    expect(w.find('[data-test="curve-mode"]').exists()).toBe(false)
    expect(w.text()).toContain('经济差曲线')
  })
})

describe('GoldCurve 胜率模式：状态重置与互斥', () => {
  const mk = (openId: string | null = null, c: GoldCurveModel = wpCurve) =>
    mount(GoldCurve, { props: { curve: c, deaths: null, openId } })
  const badge = (w: ReturnType<typeof mk>, i = 0) => w.findAll('[data-test="curve-turn-badge"]')[i]

  it('换局：无胜率 → 有胜率回到胜率模式', async () => {
    const w = mk(null, { ...curve, winProb: null, mySide: null })
    expect(w.text()).toContain('经济差曲线')
    await w.setProps({ curve: wpCurve })
    expect(w.text()).toContain('胜率曲线')
  })

  it('换局：用户切到经济差后换局，重新默认胜率；转折弹出卡关闭', async () => {
    const w = mk()
    await badge(w).trigger('click')
    expect(w.find('[data-test="curve-turn-popover"]').exists()).toBe(true)
    await w.setProps({ curve: { ...wpCurve } })
    expect(w.find('[data-test="curve-turn-popover"]').exists()).toBe(false)
    await w.find('[data-test="curve-mode-gold"]').trigger('click')
    await w.setProps({ curve: { ...wpCurve } })
    expect(w.text()).toContain('胜率曲线')
  })

  it('同一徽标点两次：弹出卡关闭', async () => {
    const w = mk()
    await badge(w).trigger('click')
    await badge(w).trigger('click')
    expect(w.find('[data-test="curve-turn-popover"]').exists()).toBe(false)
  })

  it('开转折弹出卡时通知父组件清空 openId', async () => {
    const w = mk('F1')
    await badge(w).trigger('click')
    expect(w.emitted('update:openId')?.at(-1)).toEqual([null])
  })

  it('openId 变为非空时关闭转折弹出卡', async () => {
    const w = mk()
    await badge(w).trigger('click')
    await w.setProps({ openId: 'F1' })
    expect(w.find('[data-test="curve-turn-popover"]').exists()).toBe(false)
  })

  it('胜率模式：移入显示读数，移出后消失', async () => {
    const w = mk()
    const plot = w.find('[data-test="curve-plot"]')
    ;(plot.element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 140 }) as DOMRect
    await plot.trigger('mousemove', { clientX: 0 })
    expect(w.find('[data-test="curve-readout"]').text()).toContain('蓝方胜率')
    await plot.trigger('mouseleave')
    expect(w.find('[data-test="curve-readout"]').exists()).toBe(false)
  })

  it('openId 本就为空时开转折弹出卡不多发 update:openId', async () => {
    const w = mk()
    await badge(w).trigger('click')
    expect(w.emitted('update:openId')).toBeUndefined()
  })

  it('无障碍：模式按钮 aria-pressed，徽标 aria-label', () => {
    const w = mk()
    expect(w.find('[data-test="curve-mode-wp"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-test="curve-mode-gold"]').attributes('aria-pressed')).toBe('false')
    expect(badge(w).attributes('aria-label')).toBe('第 20 分钟 蓝方胜率 49% → 74%')
  })

  it('胜率模式无胜率读数点时不回退经济差读数', async () => {
    const w = mk(null, { ...wpCurve, winProb: { points: [], turns: [] } })
    const plot = w.find('[data-test="curve-plot"]')
    ;(plot.element as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 140 }) as DOMRect
    await plot.trigger('mousemove', { clientX: 0 })
    expect(w.find('[data-test="curve-readout"]').exists()).toBe(false)
  })
})
