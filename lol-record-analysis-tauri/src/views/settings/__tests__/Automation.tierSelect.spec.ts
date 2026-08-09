/**
 * Automation.vue 段位下拉「v-model + @update:value 双写同一 ref」缺陷回归测试。
 *
 * 背景（Critical 缺陷）：
 * 段位下拉曾经同时写了 `v-model:value="opggTier"` 与 `@update:value="updateOpggTier"`。
 * Vue 3 会把这两者编译进同一个 onUpdate:value 处理器数组，按下标顺序同步派发：
 * 下标 0 是 v-model 的自动赋值函数，下标 1 才是 updateOpggTier。`opggTier` 是从
 * useOpggTier() 解构出来的 tier ref（同一个 Ref 对象），所以等 updateOpggTier(next)
 * 被调用时，tier.value 已经被 v-model 写成了 next。而 useOpggTier.switchTier 开头有一句
 * no-op 守卫 `if (next === tier.value) return true`——每次真实切换都会命中，于是
 * switchTier 直接返回 true，跳过写配置、跳过 invoke('update_opgg_data')、跳过
 * bumpOpggRevision，失败反馈分支也永远走不到。用户看到下拉跳到了新段位（v-model 直接
 * 写的），实际什么都没发生——是「伪装成功」的缺陷。
 *
 * 修复：把 `v-model:value="opggTier"` 改成单向绑定 `:value="opggTier"`，保留
 * `@update:value="updateOpggTier"` 作为唯一写入路径（见 Automation.vue 中段位 <n-select>）。
 *
 * 为什么现在直接挂载 Automation.vue（而不是像早期版本那样搭手写复现组件）：
 * usePickRules/useBanRules 走的是同一个已 mock 的 @renderer/services/ipc；
 * RuleEditModal / BpSuggestModal / VueDraggable 这些重组件在 shallow 模式下会被自动
 * stub（stub 仍会转发默认插槽内容，只是不再递归渲染，参见 vue-test-utils 的
 * shallow stub 行为）；get_champion_options 走的 invoke 也已 mock。这样接线缺陷就直接
 * 长在生产文件上：如果有人把 Automation.vue 的接线改回 v-model:value，本文件不用同步
 * 改任何 fixture，测试会直接对生产文件转红。
 *
 * naive-ui 的 <n-select> 在真实环境下用 VBinder/VFollower 把下拉选项 teleport 到 body，
 * 在 jsdom 里既慢又难驱动，所以用 global.stubs 把 naive-ui 内部注册名为 'Select' 的组件
 * （跟 BpSuggestModal.spec.ts / RuleEditModal.spec.ts 同一约定：naive-ui 组件的运行时
 * `name` 不带 N 前缀，是 'Select' 不是 'NSelect'）替换成一个受控的原生 <select>。
 * Automation.vue 里有三处 <n-select>（段位 / 添加英雄-Pick / 添加英雄-Ban），三者都会
 * 命中这个 stub；用 <option> 是否包含 TIER_OPTIONS 的段位值（如 master_plus）来定位到
 * 段位下拉这一个 <select>，避免踩到另外两个英雄选择器。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import naive from 'naive-ui'

vi.mock('@renderer/services/ipc', () => ({
  getConfigByIpc: vi.fn(),
  putConfigByIpc: vi.fn()
}))
vi.mock('@renderer/services/http', () => ({ assetPrefix: '' }))

const messageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
// jsdom 下没有 n-message-provider，替换 useMessage 为共享 mock（其余 naive-ui 导出保持原样），
// 与 UnifiedTagRow.spec.ts 同一约定。
vi.mock('naive-ui', async importOriginal => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return { ...actual, useMessage: () => messageMock }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { putConfigByIpc } from '@renderer/services/ipc'
import { invoke } from '@tauri-apps/api/core'
import Automation from '../Automation.vue'

const mockPut = vi.mocked(putConfigByIpc)
const mockInvoke = vi.mocked(invoke)

// 与 BpSuggestModal.spec.ts / Automation.tierSelect.spec.ts 早期版本相同的约定：
// 用真实 <select> 承接 <n-select>，value 受控回显 + change 时 emit update:value，
// 便于测试用 DOM 层面的 setValue 驱动交互。
const stubs = {
  Select: {
    props: ['value', 'options'],
    emits: ['update:value'],
    template:
      '<select :value="value" @change="$emit(\'update:value\', $event.target.value)">' +
      '<option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>' +
      '</select>'
  }
}

/** 定位段位下拉：Automation.vue 有三个 <n-select>，用是否含 master_plus 选项来锁定这一个。 */
function findTierSelect(w: { findAll: (s: string) => { html(): string }[] }) {
  const select = w
    .findAll('select')
    .find(s => s.html().includes('value="master_plus"')) as unknown as {
    setValue(v: string): Promise<void>
    element: HTMLSelectElement
  }
  if (!select) throw new Error('未找到段位 <select>（含 master_plus 选项）')
  return select
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_champion_options') return []
    return undefined
  })
})

describe('Automation.vue 段位下拉接线（挂载真实组件）', () => {
  it('切换段位：真的写配置、强制重拉 OP.GG 快照', async () => {
    mockPut.mockResolvedValue(undefined)

    const w = mount(Automation, {
      global: { plugins: [naive], stubs }
    })
    // 等 onMounted 里一串 await（get_champion_options / getConfigByIpc / loadOpggTier /
    // reloadPickRules / reloadBanRules）落定，段位 <select> 才会带上稳定的初始值。
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    // 这次切换专门校验的 invoke 调用发生在 mount 阶段的 get_champion_options 之后，
    // 用 mockResolvedValueOnce 追加一条，不影响上面 beforeEach 里的默认 mockImplementation。
    mockInvoke.mockImplementationOnce(async () => ({ mode: 'ranked', patch: '16.13' }))

    const tierSelect = findTierSelect(w)
    await tierSelect.setValue('master_plus')
    await new Promise(r => setTimeout(r, 0))
    await w.vm.$nextTick()

    expect(mockPut).toHaveBeenCalledWith('settings.opgg.tier', 'master_plus')
    expect(mockInvoke).toHaveBeenCalledWith('update_opgg_data', { mode: 'ranked' })
    expect(tierSelect.element.value).toBe('master_plus')
  })
})
