/**
 * BpSuggestModal 组件单元测试
 *
 * 验证：
 * - 样本不足时显示空态
 * - ok 状态下渲染三分区候选与依据文案
 * - 「加入」按钮把英雄追加进对应兜底池（去重）并置灰
 * - opgg_ok=false 时 T0 分区显示降级提示
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))

import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '@renderer/services/ipc'
import BpSuggestModal from '../BpSuggestModal.vue'
import type { BpSuggestResult } from '@renderer/types/bpSuggest'

const stubs = {
  Modal: { template: '<div><slot /></div>' },
  Card: { template: '<div><slot /><slot name="header-extra" /></div>' },
  Button: {
    template: '<button :disabled="$attrs.disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  Tag: { template: '<span><slot /></span>' },
  Space: { template: '<div><slot /></div>' },
  Spin: { template: '<div>spinning</div>' },
  Empty: { template: '<div>{{ $attrs.description }}<slot /><slot name="extra" /></div>' },
  Text: { template: '<span><slot /></span>' },
  Select: { template: '<select />' },
  Avatar: { template: '<img />' }
}

const championOptions = [
  { label: '盖伦', value: 86, realName: 'Garen', nickname: 'garen' },
  { label: '亚索', value: 157, realName: 'Yasuo', nickname: 'yasuo' },
  { label: '劫', value: 238, realName: 'Zed', nickname: 'zed' }
]

function okResult(overrides: Partial<BpSuggestResult> = {}): BpSuggestResult {
  return {
    main_position: 'TOP',
    sample_games: 25,
    opgg_ok: true,
    frequent: [
      {
        champion_id: 86,
        suggested_pool: 'pick',
        already_in_pool: false,
        evidence: { games: 12, win_rate: 0.58 }
      }
    ],
    nemesis: [
      {
        champion_id: 238,
        suggested_pool: 'ban',
        already_in_pool: false,
        evidence: { losses_against: 5, loss_games: 8 }
      }
    ],
    hot_t0: [
      {
        champion_id: 157,
        suggested_pool: 'ban',
        already_in_pool: false,
        evidence: { opgg_tier: 1, position: 'MIDDLE', opgg_win_rate: 0.523 }
      }
    ],
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConfigByIpc).mockResolvedValue([])
})

describe('BpSuggestModal', () => {
  it('shows insufficient state when sample_games < 10', async () => {
    vi.mocked(invoke).mockResolvedValue(
      okResult({ sample_games: 4, frequent: [], nemesis: [], hot_t0: [] })
    )
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('近期对局太少')
  })

  it('renders three sections with evidence text', async () => {
    vi.mocked(invoke).mockResolvedValue(okResult())
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('盖伦')
    expect(w.text()).toContain('12 场')
    expect(w.text()).toContain('劫')
    expect(w.text()).toContain('亚索')
  })

  it('adopt appends champion to pick pool without duplicates and greys out', async () => {
    vi.mocked(invoke).mockResolvedValue(okResult())
    vi.mocked(getConfigByIpc).mockResolvedValue([157]) // 池里已有 157
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    const btn = w.findAll('button').find(b => b.text().includes('加入英雄池'))!
    await btn.trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(vi.mocked(putConfigByIpc)).toHaveBeenCalledWith(
      'settings.auto.pickChampionSlice',
      [157, 86]
    )
    expect(w.emitted('adopted')).toBeTruthy()
  })

  it('shows opgg degraded note when opgg_ok=false', async () => {
    vi.mocked(invoke).mockResolvedValue(okResult({ opgg_ok: false, hot_t0: [] }))
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('OP.GG 数据暂不可用')
  })

  it('adopt failure does not grey the card or emit adopted', async () => {
    vi.mocked(invoke).mockResolvedValue(okResult())
    vi.mocked(getConfigByIpc).mockResolvedValue([])
    vi.mocked(putConfigByIpc).mockRejectedValue(new Error('ipc down'))
    const w = mount(BpSuggestModal, { props: { show: true, championOptions }, global: { stubs } })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    const btn = w.findAll('button').find(b => b.text().includes('加入英雄池'))!
    await btn.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(w.emitted('adopted')).toBeFalsy()
    // 失败后按钮不该停留在「已加入」灰态
    expect(btn.text()).not.toContain('已加入')
  })
})
