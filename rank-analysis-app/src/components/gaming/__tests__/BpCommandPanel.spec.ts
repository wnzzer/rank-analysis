/** BP 操作台组件回归：状态文案、卡片标记与用户操作上抛。 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import naive from 'naive-ui'
import BpCommandPanel from '../BpCommandPanel.vue'
import type { BpCandidate, BpDamageMix } from '@renderer/types/bpPanel'

const wrappers: VueWrapper[] = []

/** 构造一张候选卡片，默认池内魔法英雄。 */
function candidate(
  championId: number,
  name: string,
  extra: Partial<BpCandidate> = {}
): BpCandidate {
  return {
    championId,
    name,
    icon: `/icon/${championId}`,
    headline: '55.5%',
    caption: '评估胜率',
    inPool: true,
    damage: 'magic',
    reasons: [{ kind: 'counter', label: '克制亚索', delta: 1.8 }],
    ...extra
  }
}

const MIX: BpDamageMix = { physical: 2, magic: 1, known: 3 }

/** 挂载操作台，未指定的属性取「轮到我 pick、自动目标为阿狸」的默认场景。 */
function mountPanel(props: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(BpCommandPanel, {
    attachTo: document.body,
    global: { plugins: [naive] },
    props: {
      action: 'pick',
      stage: 'acting',
      candidates: [candidate(103, '阿狸'), candidate(711, '薇古丝', { inPool: false })],
      autoTargetId: 103,
      hoveredId: 103,
      overridden: false,
      secsLeft: 12,
      totalSecs: 27,
      allyMix: MIX,
      enemyMix: { physical: 0, magic: 0, known: 0 },
      ...props
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
})

describe('BpCommandPanel', () => {
  it('should announce the auto target with countdown when auto is active', () => {
    const wrapper = mountPanel()

    expect(wrapper.get('[data-test="status"]').text()).toBe('不操作将在 12s 后自动选择 阿狸')
    expect(wrapper.get('[data-test="card-103"]').classes()).toContain('is-auto')
  })

  it('should drop the auto marker once the user has taken over', () => {
    const wrapper = mountPanel({ overridden: true, hoveredId: 711 })

    expect(wrapper.get('[data-test="status"]').text()).toContain('你已接管')
    expect(wrapper.find('.is-auto').exists()).toBe(false)
    expect(wrapper.get('[data-test="card-711"]').classes()).toContain('is-hovered')
  })

  it('should tell the user nothing will be done for them when there is no auto target', () => {
    const wrapper = mountPanel({ autoTargetId: null, hoveredId: null })

    expect(wrapper.get('[data-test="status"]').text()).toContain('系统不会替你操作')
    expect(wrapper.get('[data-test="confirm"]').attributes('disabled')).toBeDefined()
  })

  it('should mark out-of-pool cards', () => {
    const wrapper = mountPanel()

    expect(wrapper.get('[data-test="card-711"]').classes()).toContain('out-of-pool')
    expect(wrapper.get('[data-test="card-711"]').text()).toContain('池外')
    expect(wrapper.get('[data-test="card-103"]').text()).not.toContain('池外')
  })

  it('should emit hover on card click and confirm on button click', async () => {
    const wrapper = mountPanel()

    await wrapper.get('[data-test="card-711"]').trigger('click')
    await wrapper.get('[data-test="confirm"]').trigger('click')

    expect(wrapper.emitted('hover')).toEqual([[711]])
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('should map number keys to cards and Enter to confirm', () => {
    const wrapper = mountPanel()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '9' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(wrapper.emitted('hover')).toEqual([[711]])
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('should collapse and ignore input while waiting', () => {
    const wrapper = mountPanel({ stage: 'waiting' })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))

    expect(wrapper.find('.bp-body').exists()).toBe(false)
    expect(wrapper.get('[data-test="status"]').text()).toBe('轮到你时将自动选择 阿狸')
    expect(wrapper.emitted('hover')).toBeUndefined()
  })

  it('should only suggest while waiting when nothing will run automatically', () => {
    const wrapper = mountPanel({ stage: 'waiting', autoTargetId: null, hoveredId: null })

    expect(wrapper.get('[data-test="status"]').text()).toBe('轮到你时建议选择 阿狸')
  })

  it('should expand on demand while waiting and allow pre-selecting a pick', async () => {
    const wrapper = mountPanel({ stage: 'waiting' })

    await wrapper.get('[data-test="toggle"]').trigger('click')
    expect(wrapper.find('.bp-body').exists()).toBe(true)

    await wrapper.get('[data-test="card-711"]').trigger('click')
    expect(wrapper.emitted('hover')).toEqual([[711]])
  })

  it('should not allow confirming before my turn', async () => {
    const wrapper = mountPanel({ stage: 'waiting' })
    await wrapper.get('[data-test="toggle"]').trigger('click')

    const confirm = wrapper.get('[data-test="confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(confirm.text()).toBe('轮到你时可锁定')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('should be view-only when expanded while waiting to ban', async () => {
    const wrapper = mountPanel({ action: 'ban', stage: 'waiting' })
    await wrapper.get('[data-test="toggle"]').trigger('click')

    await wrapper.get('[data-test="card-711"]').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))

    expect(wrapper.find('.bp-body').classes()).toContain('read-only')
    expect(wrapper.emitted('hover')).toBeUndefined()
  })

  it('should not draw the countdown ring on the auto target before my turn', async () => {
    const wrapper = mountPanel({ stage: 'waiting' })
    await wrapper.get('[data-test="toggle"]').trigger('click')

    expect(wrapper.find('.bp-auto').exists()).toBe(true)
    expect(wrapper.find('.bp-ring').exists()).toBe(false)
  })

  it('should collapse again from the toggle', async () => {
    const wrapper = mountPanel({ stage: 'waiting' })

    await wrapper.get('[data-test="toggle"]').trigger('click')
    await wrapper.get('[data-test="toggle"]').trigger('click')

    expect(wrapper.find('.bp-body').exists()).toBe(false)
  })

  it('should use ban wording and show the result when done', () => {
    const wrapper = mountPanel({ action: 'ban', stage: 'done', resultName: '劫' })

    expect(wrapper.classes()).toContain('is-ban')
    expect(wrapper.get('[data-test="status"]').text()).toBe('已禁用 劫')
  })

  it('should render the damage mix as unknown when nobody is revealed', () => {
    const wrapper = mountPanel()

    const labels = wrapper.findAll('.bp-mix-label').map(node => node.text())
    expect(labels).toEqual(['物理 67% · 魔法 33%', '未知'])
  })
})
