import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BpDecisionBar from '../BpDecisionBar.vue'
import type { BpDecision } from '@renderer/types/bpDecision'

vi.mock('@renderer/composables/useAssetUrl', () => ({
  useAssetUrl: () => ({ getChampionUrl: (id: number) => `/champion/${id}` })
}))
vi.mock('@renderer/services/ai/champion-names', () => ({
  getChampionName: (id: number) => `英雄${id}`
}))

function decision(overrides: Partial<BpDecision> = {}): BpDecision {
  return {
    action_type: 'Ban',
    target: {
      champion_id: 64,
      lock: true,
      origin: { type: 'Rule', rule_id: 'r1', rule_name: '打野保底' },
      evidence: null
    },
    rejected: [],
    mode: 'Auto',
    time_left_secs: 8,
    execute_at_secs_left: 5,
    user_overridden: false,
    is_in_progress: true,
    ...overrides
  }
}

const mountBar = (d: BpDecision | null, displaySecs = 8) =>
  mount(BpDecisionBar, { props: { decision: d, displaySecs } })

describe('BpDecisionBar', () => {
  it('decision 为 null 时不渲染', () => {
    expect(mountBar(null).find('.bp-bar').exists()).toBe(false)
  })

  it('Auto 模式展示倒计时与动作', () => {
    const w = mountBar(decision(), 8)
    expect(w.text()).toContain('8s 后自动 BAN')
  })

  it('Advisory 模式降级为建议带，不显示倒计时', () => {
    const w = mountBar(decision({ mode: 'Advisory' }))
    expect(w.text()).toContain('建议 BAN')
    expect(w.text()).not.toContain('后自动')
  })

  // 回归：还没轮到我时计时器走的是别人的回合，倒计时会一路减到 0 却什么都不
  // 发生——真机上用户先注意到的正是这个假承诺。
  it('还没轮到我时不显示倒计时，只说明会在我的回合执行', () => {
    const w = mountBar(decision({ is_in_progress: false }), 3)
    expect(w.text()).toContain('轮到你时自动 BAN')
    expect(w.text()).not.toContain('3s')
    expect(w.text()).not.toContain('s 后自动')
  })

  it('Rule 来源显示规则名并用主色', () => {
    const w = mountBar(decision())
    expect(w.text()).toContain('命中《打野保底》')
    expect(w.find('.bp-origin-rule').exists()).toBe(true)
    expect(w.find('.bp-origin-fallback').exists()).toBe(false)
  })

  it('Fallback 来源灰色弱化并显示池子规模', () => {
    const w = mountBar(
      decision({
        target: {
          champion_id: 64,
          lock: true,
          origin: { type: 'Fallback', pool_size: 8 },
          evidence: null
        }
      })
    )
    expect(w.text()).toContain('兜底池 8 选 1')
    expect(w.find('.bp-origin-fallback').exists()).toBe(true)
  })

  it('evidence 存在时追加负向依据行', () => {
    const w = mountBar(
      decision({
        target: {
          champion_id: 64,
          lock: true,
          origin: { type: 'Fallback', pool_size: 1 },
          evidence: { win_rate: 0.447, against_champion_id: 60 }
        }
      })
    )
    expect(w.find('.bp-evidence').text()).toContain('对英雄60 仅 44.7%')
  })

  it('evidence 缺失时不渲染依据行', () => {
    expect(mountBar(decision()).find('.bp-evidence').exists()).toBe(false)
  })

  it('渲染各类落选理由', () => {
    const w = mountBar(
      decision({
        rejected: [
          { type: 'Banned', champion_id: 157 },
          { type: 'Taken', champion_id: 99, by_ally: true },
          { type: 'Taken', champion_id: 89, by_ally: false },
          { type: 'CounteredBy', champion_id: 1, opponent_id: 60, subject_win_rate: 0.44 },
          { type: 'RuleNotMatched', rule_id: 'r9', rule_name: '中路专用' }
        ]
      })
    )
    const t = w.find('.bp-rejected').text()
    expect(t).toContain('英雄157（已被 ban）')
    expect(t).toContain('英雄99（队友已选）')
    expect(t).toContain('英雄89（对面已选）')
    expect(t).toContain('英雄1（被英雄60克制）')
    expect(t).toContain('《中路专用》（条件不满足）')
  })

  it('target 为 null 时说明无可执行目标', () => {
    const w = mountBar(decision({ target: null }))
    expect(w.text()).toContain('无可执行目标')
  })

  it('user_overridden 时提示已接管且不显示倒计时', () => {
    const w = mountBar(decision({ user_overridden: true }))
    expect(w.text()).toContain('你已接管')
    expect(w.text()).not.toContain('后自动')
  })

  it('点击存为规则触发 emit', async () => {
    const w = mountBar(decision())
    await w.find('.bp-save-rule').trigger('click')
    expect(w.emitted('save-rule')).toHaveLength(1)
  })
})
