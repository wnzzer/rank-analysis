/**
 * RuleEditModal 组件单元测试
 * 验证表单契约：保存禁用条件、pick 模式 emit、ban 模式 emit
 * @module components/automation/__tests__/RuleEditModal
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { NModal, NCard, NButton, NInput, NSwitch, NSelect } from 'naive-ui'
import RuleEditModal from '../RuleEditModal.vue'
import RuleConditionRow from '../RuleConditionRow.vue'
import type { PickRule, BanRule } from '@renderer/types/rules'

const opts = [
  { label: '亚索', value: 157, realName: 'Yasuo', nickname: 'yasuo' },
  { label: '锤石', value: 412, realName: 'Thresh', nickname: 'thresh' }
]

/**
 * Naive-UI 在 jsdom 中通过 teleport 渲染 NModal，导致内容被传送到 body 之外，
 * findAll('button') 找不到 slot 内容。
 * 解决方案：按 naive-ui 实际组件名（Modal/Card/Button 等）注册 stub，
 * 让内容直接内联渲染，无需依赖 teleport。
 */
const globalStubs = {
  [NModal.name!]: {
    template: '<div><slot /></div>'
  },
  [NCard.name!]: {
    template: '<div><slot /><slot name="footer" /></div>'
  },
  [NButton.name!]: {
    props: ['disabled'],
    template: '<button :disabled="disabled"><slot /></button>',
    emits: []
  },
  [NInput.name!]: {
    props: ['modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    emits: ['update:modelValue']
  },
  [NSwitch.name!]: {
    props: ['modelValue'],
    template:
      '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
    emits: ['update:modelValue']
  },
  [NSelect.name!]: {
    props: ['modelValue', 'value', 'options'],
    template: '<select></select>'
  },
  [RuleConditionRow.__name!]: {
    props: ['modelValue', 'championOptions'],
    template: '<div class="mock-condition-row"></div>'
  }
}

describe('RuleEditModal', () => {
  /**
   * 测试：当 conditions 为空时保存按钮应被禁用
   */
  it('save button is disabled when conditions empty', () => {
    const w = mount(RuleEditModal, {
      props: { show: true, mode: 'pick', championOptions: opts },
      global: { stubs: globalStubs }
    })
    const saveBtn = w.findAll('button').find(b => b.text().trim() === '保存')
    expect(saveBtn).toBeDefined()
    expect(saveBtn?.attributes('disabled')).toBeDefined()
  })

  /**
   * 测试：pick 模式下保存应 emit 含 lock 字段的 PickRule
   */
  it('save emits a PickRule with lock field for pick mode', async () => {
    const initial: PickRule = {
      id: 'r1',
      name: '测试',
      enabled: true,
      conditions: [{ type: 'Position', value: 'middle' }],
      action: { champion_id: 157, lock: false }
    }
    const w = mount(RuleEditModal, {
      props: {
        show: true,
        mode: 'pick',
        championOptions: opts,
        initial
      },
      global: { stubs: globalStubs }
    })
    await w.vm.$nextTick()
    const saveBtn = w.findAll('button').find(b => b.text().trim() === '保存')!
    await saveBtn.trigger('click')

    const emitted = w.emitted('save')
    expect(emitted).toBeTruthy()
    const rule = emitted![0][0] as PickRule
    expect(rule.action.lock).toBe(false)
    expect(rule.action.champion_id).toBe(157)
    expect(rule.conditions).toHaveLength(1)
  })

  /**
   * 测试：ban 模式下保存应 emit 不含 lock 字段的 BanRule
   */
  it('save emits a BanRule without lock field for ban mode', async () => {
    const initial: BanRule = {
      id: 'b1',
      name: '禁刀妹',
      enabled: true,
      conditions: [{ type: 'Position', value: 'top' }],
      action: { champion_id: 89 }
    }
    const w = mount(RuleEditModal, {
      props: {
        show: true,
        mode: 'ban',
        championOptions: opts,
        initial
      },
      global: { stubs: globalStubs }
    })
    await w.vm.$nextTick()
    const saveBtn = w.findAll('button').find(b => b.text().trim() === '保存')!
    await saveBtn.trigger('click')

    const emitted = w.emitted('save')
    expect(emitted).toBeTruthy()
    const rule = emitted![0][0] as BanRule & { action: Record<string, unknown> }
    expect(rule.action.champion_id).toBe(89)
    expect('lock' in rule.action).toBe(false)
  })
})
