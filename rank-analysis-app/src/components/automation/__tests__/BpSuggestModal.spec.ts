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
  // 真实 <select>：value 受控回显 + change 时 emit update:value，
  // 以便测试用 DOM 层面的 setValue 驱动 onPositionChange，不依赖组件内部暴露。
  Select: {
    props: ['value', 'options'],
    emits: ['update:value'],
    template:
      '<select :value="value" @change="$emit(\'update:value\', $event.target.value)">' +
      '<option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>' +
      '</select>'
  },
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
    opgg_stale: false,
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

  it('position select re-invokes with explicit value (including empty) and is not overwritten by main_position', async () => {
    vi.mocked(invoke).mockResolvedValue(okResult())
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    // 首载自动模式：position 传 null，让后端推断
    expect(vi.mocked(invoke).mock.calls[0][1]).toEqual({ position: null })
    // 自动模式下，下拉回填成后端推断出的 main_position
    expect((w.find('select').element as HTMLSelectElement).value).toBe('TOP')

    // 用户显式切到「全部分路」（空串）
    await w.find('select').setValue('')
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(vi.mocked(invoke).mock.calls.at(-1)?.[1]).toEqual({ position: '' })
    // main_position 仍是 'TOP'，但用户已显式选择「全部分路」，下拉不该被响应覆写回去
    expect((w.find('select').element as HTMLSelectElement).value).toBe('')
  })

  it('重新生成 keeps auto semantics until user touches the position select', async () => {
    vi.mocked(invoke).mockResolvedValue(okResult())
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    const regenBtn = w.findAll('button').find(b => b.text().includes('重新生成'))!

    // 用户没动过下拉：重新生成应维持自动语义（position: null）
    await regenBtn.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(vi.mocked(invoke).mock.calls.at(-1)?.[1]).toEqual({ position: null })

    // 用户显式选了分路后，重新生成应传该显式值
    await w.find('select').setValue('MIDDLE')
    await new Promise(r => setTimeout(r, 0))
    await regenBtn.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(vi.mocked(invoke).mock.calls.at(-1)?.[1]).toEqual({ position: 'MIDDLE' })
  })

  it('serializes concurrent adopts to the same pool so both writes land', async () => {
    // frequent 卡（86，pick）与 hot_t0 卡（157，suggested_pool=ban，反向按钮转入英雄池）
    // 都写 pickChampionSlice：不串行化会互相用旧读值覆盖对方的写入。
    vi.mocked(invoke).mockResolvedValue(okResult())
    let poolState: number[] = []
    vi.mocked(getConfigByIpc).mockImplementation(async () => [...poolState] as never)
    vi.mocked(putConfigByIpc).mockImplementation(async (_key, value) => {
      await new Promise(r => setTimeout(r, 5))
      poolState = value as number[]
    })
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    const addBtn = w.findAll('button').find(b => b.text().includes('加入英雄池'))!
    const convertBtn = w.findAll('button').find(b => b.text().includes('转入英雄池'))!

    // 不等待第一次点击完成就触发第二次，制造跨卡竞态
    const p1 = addBtn.trigger('click')
    const p2 = convertBtn.trigger('click')
    await Promise.all([p1, p2])
    // waitFor：真实计时器下轮询等待写入链稳定（全量并行负载大时固定 30ms 会不足）
    await vi.waitFor(() => {
      expect(poolState).toHaveLength(2)
    })

    expect(poolState).toEqual(expect.arrayContaining([86, 157]))
    expect(poolState).toEqual(expect.arrayContaining([86, 157]))
    const lastCall = vi.mocked(putConfigByIpc).mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual(expect.arrayContaining([86, 157]))
  })

  it('shows a warning tag next to hot_t0 title when opgg_stale is true', async () => {
    vi.mocked(invoke).mockResolvedValue(okResult({ opgg_stale: true }))
    const w = mount(BpSuggestModal, {
      props: { show: true, championOptions },
      global: { stubs }
    })
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()
    expect(w.text()).toContain('OP.GG 数据为过期缓存')
  })
})
