import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerProfilePopover from '../PlayerProfilePopover.vue'

describe('PlayerProfilePopover', () => {
  it('无 puuid 时原样渲染 trigger，不包弹层（隐藏战绩场景）', () => {
    const wrapper = mount(PlayerProfilePopover, {
      props: { puuid: '' },
      slots: { default: () => '某玩家' }
    })
    expect(wrapper.text()).toBe('某玩家')
    expect(wrapper.findComponent({ name: 'Popover' }).exists()).toBe(false)
  })

  it('有 puuid 时包 NPopover（hover 250ms 触发 + 边界翻转），触发 slot 保留', () => {
    const wrapper = mount(PlayerProfilePopover, {
      props: { puuid: 'p1' },
      slots: { default: () => '某玩家' },
      global: { stubs: { PlayerProfileCard: true } }
    })
    expect(wrapper.text()).toContain('某玩家')
    const popover = wrapper.findComponent({ name: 'Popover' })
    expect(popover.exists()).toBe(true)
    expect(popover.props('trigger')).toBe('hover')
    expect(popover.props('placement')).toBe('right')
    expect(popover.props('delay')).toBe(250)
    expect(popover.props('flip')).toBe(true)
  })
})
