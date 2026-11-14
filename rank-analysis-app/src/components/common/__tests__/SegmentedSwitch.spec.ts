/**
 * 轻量分段切换：选中态语义、只在切到另一项时发事件、禁用项不可选。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SegmentedSwitch from '../SegmentedSwitch.vue'

const options = [
  { value: 'good', label: '推荐应对' },
  { value: 'bad', label: '谨慎选择' },
  { value: 'off', label: '未开放', disabled: true, title: '暂不可用' }
]

function mountSwitch(value = 'good') {
  return mount(SegmentedSwitch, { props: { value, options, ariaLabel: '推荐类型' } })
}

describe('SegmentedSwitch', () => {
  it('should render a radiogroup with the current option checked', () => {
    const w = mountSwitch('bad')
    expect(w.get('[role="radiogroup"]').attributes('aria-label')).toBe('推荐类型')
    expect(w.get('[data-segment="bad"]').attributes('aria-checked')).toBe('true')
    expect(w.get('[data-segment="good"]').attributes('aria-checked')).toBe('false')
    expect(w.get('[data-segment="bad"]').classes()).toContain('active')
  })

  it('should emit update:value only when switching to another option', async () => {
    const w = mountSwitch('good')
    await w.get('[data-segment="good"]').trigger('click')
    expect(w.emitted('update:value')).toBeUndefined()
    await w.get('[data-segment="bad"]').trigger('click')
    expect(w.emitted('update:value')).toEqual([['bad']])
  })

  it('should disable options and keep their hint', async () => {
    const w = mountSwitch('good')
    const off = w.get('[data-segment="off"]')
    expect(off.attributes('disabled')).toBeDefined()
    expect(off.attributes('title')).toBe('暂不可用')
    await off.trigger('click')
    expect(w.emitted('update:value')).toBeUndefined()
  })
})
