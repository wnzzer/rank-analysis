import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TeamStrengthBar from '../TeamStrengthBar.vue'
import { EMPTY_LINEUP_SCORE, type LineupScore } from '@renderer/services/lineupScore'

function score(v: number, covered = 5, total = 5, playerAdjusted = false): LineupScore {
  return { score: v, covered, total, bestTier: 1, playerAdjusted }
}

describe('TeamStrengthBar', () => {
  it('双方都有分数时渲染对比条与差值文案', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(53.0), enemy: score(50.0) }
    })
    expect(wrapper.find('.lineup-strength').exists()).toBe(true)
    expect(wrapper.text()).toContain('53.0')
    expect(wrapper.text()).toContain('50.0')
    expect(wrapper.text()).toContain('我方领先 3.0')
  })

  it('敌方领先时文案反向', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(48.0), enemy: score(52.4) }
    })
    expect(wrapper.text()).toContain('敌方领先 4.4')
  })

  it('双方接近时文案中性', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(50.0), enemy: score(50.0) }
    })
    expect(wrapper.text()).toContain('双方阵容接近')
  })

  it('任一方无数据（null）→ 整块隐藏，不渲染', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: EMPTY_LINEUP_SCORE, enemy: score(50.0) }
    })
    expect(wrapper.find('.lineup-strength').exists()).toBe(false)
  })

  it('加权后显示「已按玩家近期画像加权」提示', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(53.0, 5, 5, true), enemy: score(50.0) }
    })
    expect(wrapper.text()).toContain('已按玩家近期画像加权')
  })

  it('未加权时标注数据来源为 OP.GG meta', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(53.0), enemy: score(50.0) }
    })
    expect(wrapper.text()).toContain('OP.GG 全球 meta')
  })

  it('覆盖度信息：双方 covered/total 都展示', () => {
    const wrapper = mount(TeamStrengthBar, {
      props: { mine: score(53.0, 3, 5), enemy: score(50.0, 4, 5) }
    })
    expect(wrapper.text()).toContain('3/5')
    expect(wrapper.text()).toContain('4/5')
  })
})
